#!/usr/bin/env python3
"""
Phase 3 — Stores Allocate: routing received material to Production vs Dispatch, then Production's
Material Indent -> Stores' release into WIP, against real TEST-PROJ (project 242).

Two items, both raised/quoted/selected/issued/received/QC-approved the same way Phase 2 already
proves works (self-contained here too, not dependent on Phase 2 having run first, so this phase and
Phase T can run in parallel or standalone):
  - Item PROD (item_id 11): routed to Production via route-self -> shows up on Production's own
    cross-project Material Indent worklist -> Production raises an indent against it -> Stores
    releases it, which actually moves material into WIP (material_issues, the reservation's
    qty_issued).
  - Item DISP (item_id 12): routed to Dispatch via route-self -> confirmed visible as
    self_routed_to='dispatch' on the project's own BOM view (Dispatch's own readiness signal).
    Full packing-list generation is deliberately Phase 5's job (blocked on the packing-list format
    decision, see TEST_PLAN.md) -- this phase only proves the routing itself worked and that a
    dispatch-routed item is correctly REJECTED from being indented.

Run standalone:  python3 scripts/test_e2e/phase3_stores_allocate.py
"""
import sys

import requests

sys.path.insert(0, __file__.rsplit("/", 1)[0])
from common import api, must_ok, login, turso_execute, turso_query

PROJECT_ID = 242  # TEST-PROJ

ITEM_PROD = {"item_id": 11, "name": "APH TUBE BS6323 PART V 48.30 OD X 2.34 TH X 6.1 MTR", "qty": 8}
ITEM_DISP = {"item_id": 12, "name": "APH TUBE BS6323 PART V 50.80 OD X 2.34 TH X 6.1 MTR", "qty": 3}
ALL_ITEM_IDS = [ITEM_PROD["item_id"], ITEM_DISP["item_id"]]
SUPPLIER_NAME = "ZZ-PHASE3-TEST-SUPPLIER (safe to delete)"


def reset():
    ids = ",".join(str(i) for i in ALL_ITEM_IDS)
    bom_id_sql = f"SELECT id FROM bom_items WHERE project_id = {PROJECT_ID} AND item_id IN ({ids})"
    # material_issues.indent_item_id points at material_indent_items (no cascade), so it must go
    # before material_indents -- whose own delete cascades onto material_indent_items automatically
    # (real PRAGMA foreign_key_list check, same discipline TEST_PLAN.md's own trap note asks for).
    turso_execute(f"DELETE FROM material_issues WHERE bom_item_id IN ({bom_id_sql})")
    turso_execute("DELETE FROM material_indents WHERE id IN "
                   f"(SELECT DISTINCT indent_id FROM material_indent_items WHERE bom_item_id IN ({bom_id_sql}))")
    turso_execute(f"DELETE FROM bom_item_child_routing WHERE bom_item_id IN ({bom_id_sql})")
    turso_execute(f"DELETE FROM inward_approvals WHERE bom_item_id IN ({bom_id_sql})")
    turso_execute(f"DELETE FROM qc_records WHERE bom_item_id IN ({bom_id_sql})")
    turso_execute(f"DELETE FROM bom_item_receipts WHERE bom_item_id IN ({bom_id_sql})")
    turso_execute(f"DELETE FROM inventory_reservations WHERE bom_item_id IN ({bom_id_sql})")
    turso_execute("DELETE FROM po_delivery_lot_items WHERE po_item_id IN "
                   f"(SELECT poi.id FROM po_items poi WHERE poi.bom_item_id IN ({bom_id_sql}))")
    turso_execute("DELETE FROM po_delivery_lots WHERE po_id IN "
                   "(SELECT id FROM purchase_orders WHERE supplier_id IN "
                   f"(SELECT id FROM suppliers WHERE name = '{SUPPLIER_NAME}'))")
    turso_execute(f"DELETE FROM po_items WHERE bom_item_id IN ({bom_id_sql})")
    turso_execute("DELETE FROM purchase_orders WHERE supplier_id IN "
                   f"(SELECT id FROM suppliers WHERE name = '{SUPPLIER_NAME}')")
    turso_execute(f"DELETE FROM supplier_quotes WHERE bom_item_id IN ({bom_id_sql})")
    turso_execute("UPDATE purchase_requisitions SET awarded_supplier_id = NULL WHERE awarded_supplier_id IN "
                  f"(SELECT id FROM suppliers WHERE name = '{SUPPLIER_NAME}')")
    turso_execute(f"DELETE FROM bom_items WHERE project_id = {PROJECT_ID} AND item_id IN ({ids})")
    turso_execute(f"DELETE FROM bom_assemblies WHERE project_id = {PROJECT_ID} AND name = 'Phase3 Allocate'")
    turso_execute(f"DELETE FROM inventory_items WHERE item_id IN ({ids})")
    turso_execute("DELETE FROM stock_receipts WHERE supplier_id IN "
                  f"(SELECT id FROM suppliers WHERE name = '{SUPPLIER_NAME}')")
    turso_execute(f"DELETE FROM suppliers WHERE name = '{SUPPLIER_NAME}'")
    print("Phase 3 reset done.")


def create_supplier(session):
    return must_ok(api(session, "POST", "/api/suppliers", json={"name": SUPPLIER_NAME}), "create_supplier")


def raise_and_receive(session, item, node_id, supplier_id):
    """Identical shape to Phase 2's own raise -> quote -> select -> issue -> receive -> QC-approve
    cycle -- deliberately not imported/shared, so this phase stays runnable with Phase 2 untouched."""
    r = api(session, "POST", "/api/purchase-requisitions", json={
        "raised_by_dept": "Engineering",
        "lines": [{
            "material_description": item["name"], "item_id": item["item_id"], "category": "standard",
            "projects": [{"project_id": PROJECT_ID, "qty_text": f"{item['qty']} Nos"}],
        }],
    })
    bom_id = must_ok(r, "raise")["bom_item_ids"][0]
    must_ok(api(session, "PATCH", f"/api/bom-items/{bom_id}", json={"assembly_id": node_id}), "assign_to_node")

    quote_id = must_ok(api(session, "POST", "/api/supplier-quotes",
                            json={"supplier_id": supplier_id, "items": [{"bom_item_id": bom_id, "unit_price": 50}]}),
                        "log_quote")["ids"][0]
    po_id = must_ok(api(session, "POST", f"/api/bom-items/{bom_id}/select-supplier", json={"quote_id": quote_id}),
                     "select_supplier")["po_id"]
    must_ok(api(session, "PATCH", f"/api/purchase-orders/{po_id}", json={"action": "issue"}), "issue_po")

    must_ok(api(session, "POST", f"/api/bom-items/{bom_id}/receive", json={
        "qty_text": str(item["qty"]),
        "receipt": {"supplier_id": supplier_id, "grn_ref": f"GRN-P3-{item['item_id']}", "invoice_no": f"INV-P3-{item['item_id']}"},
    }), "receive")

    approvals = must_ok(api(session, "GET", "/api/inward-approvals"), "get_pending_inward_approvals")
    approval = next(a for a in approvals if a["bom_item_id"] == bom_id and a["status"] == "pending")
    must_ok(api(session, "POST", f"/api/inward-approvals/{approval['id']}/decide", json={"decision": "approved"}),
            "decide_inward")
    return bom_id


def route(session, bom_id, routed_to):
    return must_ok(api(session, "POST", f"/api/bom-items/{bom_id}/route-self", json={"routed_to": routed_to}), "route-self")


def get_routing(session, bom_id):
    return must_ok(api(session, "GET", f"/api/bom-items/{bom_id}/route-self"), "get_routing")["routing"]


def get_bom_item(session, bom_id):
    items = must_ok(api(session, "GET", f"/api/projects/{PROJECT_ID}/bom?all=1"), "get_bom")["items"]
    return next((b for b in items if b["id"] == bom_id), None)


def get_indent_worklist_ids(session):
    lines = must_ok(api(session, "GET", "/api/production/material-indent-lines"), "get_indent_worklist")
    return {l["bom_item_id"] for l in lines}


def run(do_reset=True):
    if do_reset:
        reset()
    session = requests.Session()
    login(session)

    report = []
    passed = True

    def check(label, condition, detail):
        nonlocal passed
        status = "PASS" if condition else "FAIL"
        if not condition:
            passed = False
        report.append(f"[{status}] {label}: {detail}")

    supplier = create_supplier(session)
    node = must_ok(api(session, "POST", "/api/bom-assemblies",
                        json={"project_id": PROJECT_ID, "name": "Phase3 Allocate"}), "create_node")

    print("Raising, procuring, receiving and QC-approving both items (self-contained, not dependent on Phase 2)...")
    prod_id = raise_and_receive(session, ITEM_PROD, node["id"], supplier["id"])
    disp_id = raise_and_receive(session, ITEM_DISP, node["id"], supplier["id"])

    print("Stores Allocate: routing Item PROD -> Production, Item DISP -> Dispatch...")
    route(session, prod_id, "production")
    route(session, disp_id, "dispatch")

    routing_prod = get_routing(session, prod_id)
    check("Item PROD: routing decision recorded as 'production'",
          routing_prod and routing_prod["routed_to"] == "production", f"routing={routing_prod}")
    routing_disp = get_routing(session, disp_id)
    check("Item DISP: routing decision recorded as 'dispatch'",
          routing_disp and routing_disp["routed_to"] == "dispatch", f"routing={routing_disp}")

    print("Confirming each routed item is visible in its own destination module...")
    worklist_ids = get_indent_worklist_ids(session)
    check("Item PROD shows up on Production's own Material Indent worklist", prod_id in worklist_ids,
          f"worklist_ids={worklist_ids}")
    check("Item DISP does NOT show up on Production's worklist (it was routed to Dispatch)",
          disp_id not in worklist_ids, f"worklist_ids={worklist_ids}")

    disp_bom = get_bom_item(session, disp_id)
    check("Item DISP shows self_routed_to='dispatch' on the project's own BOM view (Dispatch's readiness signal)",
          disp_bom and disp_bom.get("self_routed_to") == "dispatch", f"self_routed_to={disp_bom and disp_bom.get('self_routed_to')}")

    print("Confirming a Dispatch-routed item is correctly REJECTED from being indented (Production can't self-serve it)...")
    r = api(session, "POST", "/api/material-indents", json={
        "project_id": PROJECT_ID, "items": [{"bom_item_id": disp_id, "qty_requested": ITEM_DISP["qty"]}],
    })
    check("Indenting Item DISP is rejected (not routed to Production)", r.status_code == 400, f"status={r.status_code}, body={r.text[:200]}")

    print("Production raises a real Material Indent against Item PROD...")
    indent = must_ok(api(session, "POST", "/api/material-indents", json={
        "project_id": PROJECT_ID, "items": [{"bom_item_id": prod_id, "qty_requested": ITEM_PROD["qty"]}],
    }), "raise_indent")
    indent_detail = must_ok(api(session, "GET", f"/api/material-indents/{indent['id']}"), "get_indent")
    check("Indent created with 1 item, status 'open'",
          len(indent_detail["items"]) == 1 and indent_detail["status"] == "open",
          f"items={len(indent_detail['items'])}, status={indent_detail['status']}")
    indent_item_id = indent_detail["items"][0]["id"]

    print("Fetching the indent's PDF (the physical handoff document to Stores)...")
    pdf = api(session, "GET", f"/api/material-indents/{indent['id']}/pdf")
    check("Indent PDF renders (200, application/pdf)",
          pdf.status_code == 200 and pdf.headers.get("content-type", "").startswith("application/pdf"),
          f"status={pdf.status_code}, content-type={pdf.headers.get('content-type')}")

    print("Stores releases the full quantity against the indent -> material actually leaves for WIP...")
    release = must_ok(api(session, "POST", f"/api/material-indents/{indent['id']}/items/{indent_item_id}/release",
                           json={"qty": ITEM_PROD["qty"]}), "release_indent_item")
    check("Release succeeded and returned the resulting material_issue", release.get("ok") is True and release.get("material_issue"),
          f"release={release}")

    indent_after = must_ok(api(session, "GET", f"/api/material-indents/{indent['id']}"), "get_indent_after")
    check("Indent item status flips to 'released' once the full quantity is out",
          indent_after["items"][0]["status"] == "released", f"status={indent_after['items'][0]['status']}")
    check("Indent header rolls up to 'released'", indent_after["status"] == "released", f"status={indent_after['status']}")

    print("Verifying material_issues (WIP consumption) and the reservation's qty_issued at the data layer...")
    issues = turso_query("SELECT qty FROM material_issues WHERE bom_item_id = ?", [prod_id])
    total_issued = sum(float(r["qty"]) for r in issues)
    check("A real material_issues row records the full quantity leaving for WIP",
          total_issued == ITEM_PROD["qty"], f"total_issued={total_issued}, expected={ITEM_PROD['qty']}")

    reservation = turso_query(
        "SELECT qty, qty_issued FROM inventory_reservations WHERE bom_item_id = ? AND status = 'active'", [prod_id])
    check("The active reservation against Item PROD is now fully issued (qty_issued == qty)",
          bool(reservation) and float(reservation[0]["qty_issued"]) == float(reservation[0]["qty"]),
          f"reservation={reservation}")

    print("\n".join(report))
    print("\n" + ("ALL PASSED" if passed else "SOME FAILED"))
    return passed


if __name__ == "__main__":
    sys.exit(0 if run() else 1)
