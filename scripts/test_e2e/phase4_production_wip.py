#!/usr/bin/env python3
"""
Phase 4 -- Production / WIP: turning material that's already in WIP (Phase 3's own output) into
finished, pack-ready work, against real TEST-PROJ (project 242). Self-contained -- raises/procures/
receives/QC-approves its own two items rather than depending on Phase 3 having run.

Two items, deliberately testing both branches TEST_PLAN.md calls for:
  - Item NOHOLD (item_id 13): the plain path. A Job Card is created directly against a real
    Production milestone -- NO Work Order needed for this (a Work Order is a separate, optional
    production-control layer above Job Cards, not the same thing as a Project; a plain Job Card
    only needs a milestone). Time is logged, the card is marked done (which auto-completes the
    milestone, lib/milestone-auto.js), and Production then hands the finished item to Dispatch from
    Shop Floor > Dispatch (POST /api/production/handovers). The old manual "Prod. Done" tick no
    longer exists (PATCH production_done is refused, 403); the flag is now DERIVED from handovers.
  - Item HOLD (item_id 14): the QC hold-point branch. `requires_qc_hold` can ONLY ever be set to 1
    on a Job Card generated from a real Work Order's route step that names a quality_checkpoint
    (app/api/work-orders/[id]/generate-job-cards/route.js) -- a plain, directly-created Job Card has
    no field for this at all. So THIS branch genuinely needs a real Work Order: create it, add one
    route step with a quality checkpoint, release the Work Order, generate its Job Card (which comes
    back with requires_qc_hold=1), confirm marking it done is blocked until QC explicitly releases
    the hold (POST .../qc-release), then confirm it can complete afterward.

Both items also exercise a real, previously-untested-but-already-working linkage: raising a
Material Indent WITH a job_card_id set correctly flows through to the resulting material_issues
row's own job_card_id at release time (app/api/material-indents/[id]/items/[itemId]/release,
lib/material-issues.js's issueMaterial) -- Phase 3 never used this since it never touched Job Cards.

Finally, both items are handed over to Dispatch (mandatory Production approval answered "yes") and
the phase confirms production_done was derived, the handover was recorded as approved, and both
items were placed automatically on the project's draft packing list -- nobody pressed Generate.

Run standalone:  python3 scripts/test_e2e/phase4_production_wip.py
"""
import sys

import requests

sys.path.insert(0, __file__.rsplit("/", 1)[0])
from common import api, must_ok, login, turso_execute, turso_query

PROJECT_ID = 242  # TEST-PROJ

ITEM_NOHOLD = {"item_id": 13, "name": "APH TUBE BS6323 PART V 50.80 OD X 2.9 TH X 6.1 MTR", "qty": 5}
ITEM_HOLD = {"item_id": 14, "name": "APH TUBE BS6323 PART V 60.30 OD X 2.34 TH X 6.1 MTR", "qty": 5}
ALL_ITEM_IDS = [ITEM_NOHOLD["item_id"], ITEM_HOLD["item_id"]]
SUPPLIER_NAME = "ZZ-PHASE4-TEST-SUPPLIER (safe to delete)"
TAG = "ZZ-PHASE4-TEST"  # job_cards.notes / work_orders.notes marker, used to scope reset()

MILESTONE_NOHOLD_ID = 4463  # marking_cutting, a real Production milestone on TEST-PROJ
MILESTONE_HOLD_ID = 4464    # drilling
EMPLOYEE_ID = 24            # a real active Production worker ("ABC") on the shared dev DB


def reset():
    ids = ",".join(str(i) for i in ALL_ITEM_IDS)
    bom_id_sql = f"SELECT id FROM bom_items WHERE project_id = {PROJECT_ID} AND item_id IN ({ids})"
    work_order_id_sql = f"SELECT id FROM work_orders WHERE notes = '{TAG}'"
    # A Work-Order-generated Job Card (generate-job-cards/route.js's INSERT) never gets a `notes`
    # value at all -- `notes = TAG` alone silently misses it, leaving it (and anything referencing
    # it) around to break the later work_order_operations/work_orders deletes with a real FK error.
    # Found live: this is exactly the recurring trap TEST_PLAN.md's own notes already warn about.
    job_card_id_sql = f"SELECT id FROM job_cards WHERE notes = '{TAG}' OR work_order_id IN ({work_order_id_sql})"

    # Packing lists this phase may have generated (auto-placed by the handover) --
    # pre_dispatch_approvals has NO ACTION on packing_list_id, so it must go first; packing_items
    # itself cascades from packing_lists (real PRAGMA foreign_key_list check).
    # (packing_bom_links = the view that answers "which BOM lines does a list carry": the anchor
    # column plus the assembly link table; packing_items/links cascade from packing_lists.)
    turso_execute("DELETE FROM pre_dispatch_approvals WHERE packing_list_id IN "
                   "(SELECT DISTINCT packing_list_id FROM packing_bom_links "
                  f"  WHERE bom_item_id IN ({bom_id_sql}))")
    turso_execute("DELETE FROM packing_lists WHERE id IN "
                   "(SELECT DISTINCT packing_list_id FROM packing_bom_links "
                  f"  WHERE bom_item_id IN ({bom_id_sql}))")
    turso_execute(f"DELETE FROM production_handovers WHERE bom_item_id IN ({bom_id_sql})")

    # Job Card children, then Job Cards themselves, then Work Order children, then Work Orders --
    # real PRAGMA foreign_key_list order: job_card_time_logs/job_card_consumables/material_issues
    # -> job_cards -> work_order_operations (job_cards.work_order_operation_id references it) ->
    # work_orders.
    turso_execute(f"DELETE FROM job_card_time_logs WHERE job_card_id IN ({job_card_id_sql})")
    turso_execute(f"DELETE FROM job_card_consumables WHERE job_card_id IN ({job_card_id_sql})")
    turso_execute(f"DELETE FROM material_issues WHERE bom_item_id IN ({bom_id_sql})")
    turso_execute("DELETE FROM material_indents WHERE id IN "
                   f"(SELECT DISTINCT indent_id FROM material_indent_items WHERE bom_item_id IN ({bom_id_sql}))")
    turso_execute(f"DELETE FROM work_order_change_notes WHERE work_order_id IN ({work_order_id_sql})")
    turso_execute(f"DELETE FROM work_order_materials WHERE work_order_id IN ({work_order_id_sql})")
    turso_execute(f"DELETE FROM job_cards WHERE notes = '{TAG}' OR work_order_id IN ({work_order_id_sql})")
    turso_execute(f"DELETE FROM work_order_operations WHERE work_order_id IN ({work_order_id_sql})")
    turso_execute(f"DELETE FROM work_orders WHERE notes = '{TAG}'")

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
    turso_execute(f"DELETE FROM bom_assemblies WHERE project_id = {PROJECT_ID} AND name = 'Phase4 WIP'")
    turso_execute(f"DELETE FROM inventory_items WHERE item_id IN ({ids})")
    turso_execute("DELETE FROM stock_receipts WHERE supplier_id IN "
                  f"(SELECT id FROM suppliers WHERE name = '{SUPPLIER_NAME}')")
    turso_execute(f"DELETE FROM suppliers WHERE name = '{SUPPLIER_NAME}'")
    print("Phase 4 reset done.")


def create_supplier(session):
    return must_ok(api(session, "POST", "/api/suppliers", json={"name": SUPPLIER_NAME}), "create_supplier")


def raise_and_receive(session, item, node_id, supplier_id):
    """Identical shape to Phase 2/3's own raise -> quote -> select -> issue -> receive -> QC-approve
    cycle -- deliberately not imported/shared, so this phase stays runnable standalone."""
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
        "receipt": {"supplier_id": supplier_id, "grn_ref": f"GRN-P4-{item['item_id']}", "invoice_no": f"INV-P4-{item['item_id']}"},
    }), "receive")

    approvals = must_ok(api(session, "GET", "/api/inward-approvals"), "get_pending_inward_approvals")
    approval = next(a for a in approvals if a["bom_item_id"] == bom_id and a["status"] == "pending")
    must_ok(api(session, "POST", f"/api/inward-approvals/{approval['id']}/decide", json={"decision": "approved"}),
            "decide_inward")
    return bom_id


def route(session, bom_id, routed_to):
    return must_ok(api(session, "POST", f"/api/bom-items/{bom_id}/route-self", json={"routed_to": routed_to}), "route-self")


def get_bom_item(session, bom_id):
    items = must_ok(api(session, "GET", f"/api/projects/{PROJECT_ID}/bom?all=1"), "get_bom")["items"]
    return next((b for b in items if b["id"] == bom_id), None)


def create_job_card(session, milestone_id, bom_item_id):
    return must_ok(api(session, "POST", "/api/job-cards", json={
        "milestone_id": milestone_id, "bom_item_id": bom_item_id, "notes": TAG,
    }), "create_job_card")["id"]


def log_time(session, job_card_id, minutes):
    return must_ok(api(session, "POST", f"/api/job-cards/{job_card_id}/time-logs", json={
        "employee_id": EMPLOYEE_ID, "minutes": minutes,
    }), "log_time")


def set_job_card_status(session, job_card_id, status):
    """Returns the raw response -- some callers expect this to succeed, one expects a 400 (held)."""
    return api(session, "PATCH", f"/api/job-cards/{job_card_id}", json={"status": status})


def create_indent(session, bom_item_id, qty, job_card_id):
    indent = must_ok(api(session, "POST", "/api/material-indents", json={
        "project_id": PROJECT_ID, "job_card_id": job_card_id,
        "items": [{"bom_item_id": bom_item_id, "qty_requested": qty}],
    }), "create_indent")
    detail = must_ok(api(session, "GET", f"/api/material-indents/{indent['id']}"), "get_indent")
    return indent["id"], detail["items"][0]["id"]


def release_indent_item(session, indent_id, indent_item_id, qty):
    return must_ok(api(session, "POST", f"/api/material-indents/{indent_id}/items/{indent_item_id}/release",
                        json={"qty": qty}), "release_indent_item")


def get_milestone(milestone_id):
    row = turso_query("SELECT status, actual_end FROM milestones WHERE id = ?", [milestone_id])
    return row[0] if row else None


def hand_over(session, bom_id, qty):
    """Shop Floor > Dispatch handover of one finished item. `approve` is mandatory (Production says
    whether it approves the items for dispatch); True here so the pre-dispatch slot is pre-filled."""
    return must_ok(api(session, "POST", "/api/production/handovers",
                        json={"items": [{"bom_item_id": bom_id, "qty": qty}], "approve": True}), "hand_over")


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
                        json={"project_id": PROJECT_ID, "name": "Phase4 WIP"}), "create_node")

    print("Raising, procuring, receiving, QC-approving and routing both items to Production...")
    bom_nohold = raise_and_receive(session, ITEM_NOHOLD, node["id"], supplier["id"])
    bom_hold = raise_and_receive(session, ITEM_HOLD, node["id"], supplier["id"])
    route(session, bom_nohold, "production")
    route(session, bom_hold, "production")

    # ---------------------------------------------------------------------------------------
    # Item NOHOLD -- the plain path, no Work Order needed.
    # ---------------------------------------------------------------------------------------
    print("Item NOHOLD: creating a plain Job Card directly against a Production milestone...")
    jc_nohold = create_job_card(session, MILESTONE_NOHOLD_ID, bom_nohold)

    print("Item NOHOLD: raising a Material Indent linked to this Job Card, Stores releases it...")
    indent1_id, indent1_item_id = create_indent(session, bom_nohold, ITEM_NOHOLD["qty"], jc_nohold)
    release_indent_item(session, indent1_id, indent1_item_id, ITEM_NOHOLD["qty"])
    issue1 = turso_query("SELECT job_card_id, qty FROM material_issues WHERE bom_item_id = ?", [bom_nohold])
    check("Item NOHOLD: the material_issues row is linked to the Job Card that drew it",
          bool(issue1) and issue1[0]["job_card_id"] == jc_nohold and float(issue1[0]["qty"]) == ITEM_NOHOLD["qty"],
          f"issue={issue1}, expected job_card_id={jc_nohold}")

    print("Item NOHOLD: logging time, marking the card done...")
    log_time(session, jc_nohold, 180)
    logs = turso_query("SELECT minutes FROM job_card_time_logs WHERE job_card_id = ?", [jc_nohold])
    check("Item NOHOLD: time log recorded", bool(logs) and int(logs[0]["minutes"]) == 180, f"logs={logs}")

    r = set_job_card_status(session, jc_nohold, "progress")
    check("Item NOHOLD: Job Card moves to 'progress'", r.ok, f"status={r.status_code}, body={r.text[:200]}")
    r = set_job_card_status(session, jc_nohold, "done")
    check("Item NOHOLD: Job Card marks done with no hold in the way", r.ok, f"status={r.status_code}, body={r.text[:200]}")

    milestone1 = get_milestone(MILESTONE_NOHOLD_ID)
    check("Item NOHOLD: its milestone auto-completed once its only Job Card was done",
          milestone1 and milestone1["status"] == "done" and milestone1["actual_end"], f"milestone={milestone1}")

    print("Item NOHOLD: the old manual tick is gone -- confirm the server refuses it...")
    r = api(session, "PATCH", f"/api/bom-items/{bom_nohold}", json={"production_done": True})
    check("Item NOHOLD: PATCH production_done is refused (it is derived from handovers now)",
          r.status_code == 403, f"status={r.status_code}, body={r.text[:200]}")

    print("Item NOHOLD: Production hands the finished item over to Dispatch...")
    ho1 = hand_over(session, bom_nohold, ITEM_NOHOLD["qty"])
    check("Item NOHOLD: handover recorded", ho1.get("count") == 1, f"response={ho1}")

    # ---------------------------------------------------------------------------------------
    # Item HOLD -- the QC hold-point branch. This is the ONE part of Phase 4 that genuinely
    # needs a real Work Order -- requires_qc_hold can only ever be set by generate-job-cards
    # off a route step's own quality_checkpoint; a plain Job Card has no such field at all.
    # ---------------------------------------------------------------------------------------
    print("Item HOLD: creating a real Work Order with one route step naming a QC checkpoint...")
    wo = must_ok(api(session, "POST", "/api/work-orders", json={
        "mode": "against_order", "project_id": PROJECT_ID, "qty_planned": 1, "notes": TAG,
    }), "create_work_order")
    must_ok(api(session, "POST", f"/api/work-orders/{wo['id']}/operations", json={
        "milestone_id": MILESTONE_HOLD_ID, "department": "Production", "planned_minutes": 60,
        "quality_checkpoint": "Weld inspection before proceeding",
    }), "add_operation")
    must_ok(api(session, "PATCH", f"/api/work-orders/{wo['id']}", json={"status": "released"}), "release_wo")
    gen = must_ok(api(session, "POST", f"/api/work-orders/{wo['id']}/generate-job-cards", json={}), "generate_job_cards")
    check("Work Order generated exactly 1 Job Card from its 1 route step", gen.get("created") == 1, f"gen={gen}")

    cards = must_ok(api(session, "GET", f"/api/job-cards?project_id={PROJECT_ID}&work_order_id={wo['id']}"), "list_job_cards")
    jc_hold = cards[0]["id"] if cards else None
    check("The generated Job Card carries requires_qc_hold=1 (its route step named a checkpoint)",
          bool(cards) and bool(cards[0].get("requires_qc_hold")), f"cards={cards}")

    print("Item HOLD: raising a Material Indent against it, Stores releases it (allowed even while held)...")
    indent2_id, indent2_item_id = create_indent(session, bom_hold, ITEM_HOLD["qty"], jc_hold)
    release_indent_item(session, indent2_id, indent2_item_id, ITEM_HOLD["qty"])
    issue2 = turso_query("SELECT job_card_id, qty FROM material_issues WHERE bom_item_id = ?", [bom_hold])
    check("Item HOLD: its material_issues row is linked to the Work-Order-generated Job Card",
          bool(issue2) and issue2[0]["job_card_id"] == jc_hold and float(issue2[0]["qty"]) == ITEM_HOLD["qty"],
          f"issue={issue2}, expected job_card_id={jc_hold}")

    print("Item HOLD: logging time (labor can happen while held), then trying to mark it done...")
    log_time(session, jc_hold, 240)
    r = set_job_card_status(session, jc_hold, "done")
    check("Item HOLD: marking done is BLOCKED while the QC hold point is unreleased",
          r.status_code == 400 and "held" in r.text.lower(), f"status={r.status_code}, body={r.text[:200]}")

    print("Item HOLD: QC releases the hold point, then Production can complete it...")
    must_ok(api(session, "POST", f"/api/job-cards/{jc_hold}/qc-release"), "qc_release")
    r = set_job_card_status(session, jc_hold, "done")
    check("Item HOLD: marking done now succeeds once QC released the hold", r.ok, f"status={r.status_code}, body={r.text[:200]}")

    milestone2 = get_milestone(MILESTONE_HOLD_ID)
    check("Item HOLD: its milestone auto-completed too", milestone2 and milestone2["status"] == "done" and milestone2["actual_end"],
          f"milestone={milestone2}")

    print("Item HOLD: Production hands it over too...")
    ho2 = hand_over(session, bom_hold, ITEM_HOLD["qty"])
    check("Item HOLD: handover recorded", ho2.get("count") == 1, f"response={ho2}")

    # ---------------------------------------------------------------------------------------
    # What a handover causes: production_done derived, approval stamped, items placed on the
    # project's draft packing list automatically (no Generate click).
    # ---------------------------------------------------------------------------------------
    for label, bom_id in (("NOHOLD", bom_nohold), ("HOLD", bom_hold)):
        b = get_bom_item(session, bom_id)
        check(f"Item {label}: production_done was derived from the handover", bool(b and b.get("production_done")),
              f"production_done={b and b.get('production_done')}")
        h = turso_query("SELECT production_approved, approved_by FROM production_handovers WHERE bom_item_id = ?", [bom_id])
        check(f"Item {label}: handover carries Production's approval",
              bool(h) and int(h[0]["production_approved"]) == 1 and bool(h[0]["approved_by"]), f"handover={h}")
        on_list = turso_query(
            "SELECT pl.id, pl.status FROM packing_bom_links l JOIN packing_lists pl ON pl.id = l.packing_list_id "
            "WHERE l.bom_item_id = ?", [bom_id])
        check(f"Item {label}: placed on a draft packing list automatically",
              bool(on_list) and on_list[0]["status"] == "draft", f"lists={on_list}")

    print("\n".join(report))
    print("\n" + ("ALL PASSED" if passed else "SOME FAILED"))
    return passed


if __name__ == "__main__":
    sys.exit(0 if run() else 1)
