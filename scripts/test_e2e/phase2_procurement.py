#!/usr/bin/env python3
"""
Phase 2 — the regular procurement route: raise -> quote -> select supplier -> issue PO ->
receive -> QC inward approval, for 2 scalar items with no existing stock to auto-match against.

Two items, deliberately testing both receiving paths per the 2026-09-17 conversation:
  - Item A: PO Delivery Lots configured (a real, dated, partial-delivery schedule), received in
    two partial deliveries against those lots.
  - Item B: no delivery lots at all, received in one single delivery.

Both end the same way: 'bom' source means the received quantity is credited to on_hand AND
reserved against its own bom_item the moment QC approves the inward review — never generic,
grabbable "usable" stock (that's what source='stock'/'sas' would look like; SAS is deliberately
out of scope here, see Phase T).

Run standalone:  python3 scripts/test_e2e/phase2_procurement.py
"""
import sys

import requests

sys.path.insert(0, __file__.rsplit("/", 1)[0])
from common import api, must_ok, login, turso_execute, turso_query

PROJECT_ID = 242  # TEST-PROJ

ITEM_A = {"item_id": 5, "name": "AIR NOZZLE SS, TF SERIES 25 MM", "qty": 10}
ITEM_B = {"item_id": 6, "name": "AIR NOZZLE SS, 410 TIP SERIES 140 MM LONGTOP", "qty": 5}
ALL_ITEM_IDS = [ITEM_A["item_id"], ITEM_B["item_id"]]
SUPPLIER_NAME = "ZZ-PHASE2-TEST-SUPPLIER (safe to delete)"


def reset():
    ids = ",".join(str(i) for i in ALL_ITEM_IDS)
    bom_id_sql = f"SELECT id FROM bom_items WHERE project_id = {PROJECT_ID} AND item_id IN ({ids})"
    turso_execute(f"DELETE FROM inward_approvals WHERE bom_item_id IN ({bom_id_sql})")
    turso_execute(f"DELETE FROM qc_records WHERE bom_item_id IN ({bom_id_sql})")  # auto-created "Incoming Inspection" row on receipt
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
    # bom_items.receipt_id points at stock_receipts, so bom_items must be gone before stock_receipts
    # can be deleted (a real FK-order bug found live — stock_receipts used to be deleted too early).
    turso_execute(f"DELETE FROM bom_items WHERE project_id = {PROJECT_ID} AND item_id IN ({ids})")
    turso_execute(f"DELETE FROM bom_assemblies WHERE project_id = {PROJECT_ID} AND name = 'Phase2 Procurement'")
    turso_execute(f"DELETE FROM inventory_items WHERE item_id IN ({ids})")
    turso_execute("DELETE FROM stock_receipts WHERE supplier_id IN "
                  f"(SELECT id FROM suppliers WHERE name = '{SUPPLIER_NAME}')")
    turso_execute(f"DELETE FROM suppliers WHERE name = '{SUPPLIER_NAME}'")
    print("Phase 2 reset done.")


def create_supplier(session):
    r = api(session, "POST", "/api/suppliers", json={"name": SUPPLIER_NAME})
    return must_ok(r, "create_supplier")


def raise_scalar_item(session, item, node_id):
    r = api(session, "POST", "/api/purchase-requisitions", json={
        "raised_by_dept": "Engineering",
        "lines": [{
            "material_description": item["name"], "item_id": item["item_id"], "category": "standard",
            "projects": [{"project_id": PROJECT_ID, "qty_text": f"{item['qty']} Nos"}],
        }],
    })
    bom_item_id = must_ok(r, "raise_scalar_item")["bom_item_ids"][0]
    must_ok(api(session, "PATCH", f"/api/bom-items/{bom_item_id}", json={"assembly_id": node_id}),
            "assign_to_node")
    return bom_item_id


def log_quote(session, supplier_id, bom_item_id, unit_price=100):
    r = api(session, "POST", "/api/supplier-quotes",
            json={"supplier_id": supplier_id, "items": [{"bom_item_id": bom_item_id, "unit_price": unit_price}]})
    return must_ok(r, "log_quote")["ids"][0]


def select_supplier(session, bom_item_id, quote_id):
    r = api(session, "POST", f"/api/bom-items/{bom_item_id}/select-supplier", json={"quote_id": quote_id})
    return must_ok(r, "select_supplier")["po_id"]


def issue_po(session, po_id):
    return must_ok(api(session, "PATCH", f"/api/purchase-orders/{po_id}", json={"action": "issue"}), "issue_po")


def get_po_item_id(session, po_id, bom_item_id):
    detail = must_ok(api(session, "GET", f"/api/purchase-orders/{po_id}"), "get_po_detail")
    line = next(i for i in detail["items"] if i["bom_item_id"] == bom_item_id)
    return line["id"]


def schedule_delivery_lot(session, po_id, po_item_id, qty, date, label):
    r = api(session, "POST", f"/api/purchase-orders/{po_id}/delivery-lots", json={
        "expected_delivery_date": date, "lot_label": label,
        "items": [{"po_item_id": po_item_id, "qty": qty}],
    })
    return must_ok(r, "schedule_delivery_lot")


def receive(session, bom_item_id, supplier_id, qty, grn_ref, invoice_no):
    r = api(session, "POST", f"/api/bom-items/{bom_item_id}/receive", json={
        "qty_text": str(qty),
        "receipt": {"supplier_id": supplier_id, "grn_ref": grn_ref, "invoice_no": invoice_no},
    })
    return must_ok(r, "receive")


def get_pending_inward_approval(session, bom_item_id):
    approvals = must_ok(api(session, "GET", "/api/inward-approvals"), "get_pending_inward_approvals")
    matches = [a for a in approvals if a["bom_item_id"] == bom_item_id and a["status"] == "pending"]
    return matches[0] if matches else None


def decide_inward(session, approval_id, decision, reason=None):
    body = {"decision": decision}
    if reason:
        body["reason"] = reason
    r = api(session, "POST", f"/api/inward-approvals/{approval_id}/decide", json=body)
    return must_ok(r, f"decide_inward({decision})")


def resubmit_inward(session, approval_id):
    r = api(session, "POST", f"/api/inward-approvals/{approval_id}/resubmit")
    return must_ok(r, "resubmit_inward")["id"]


def get_bom_item(session, bom_item_id):
    items = must_ok(api(session, "GET", f"/api/projects/{PROJECT_ID}/bom?all=1"), "get_bom")["items"]
    return next((b for b in items if b["id"] == bom_item_id), None)


def get_inventory_on_hand(session, item_id):
    items = must_ok(api(session, "GET", "/api/inventory-items"), "get_inventory_items")
    row = next((i for i in items if i.get("item_id") == item_id), None)
    return row["on_hand"] if row else None


def test_item_a_with_delivery_lots(session, supplier_id, node_id, check):
    """PO Delivery Lots configured; received in two partial deliveries against those lots."""
    bom_id = raise_scalar_item(session, ITEM_A, node_id)
    quote_id = log_quote(session, supplier_id, bom_id)
    po_id = select_supplier(session, bom_id, quote_id)
    issue_po(session, po_id)
    po_item_id = get_po_item_id(session, po_id, bom_id)

    schedule_delivery_lot(session, po_id, po_item_id, 6, "2026-10-01", "Lot 1")
    schedule_delivery_lot(session, po_id, po_item_id, 4, "2026-10-15", "Lot 2")

    # First partial delivery: 6 of 10. purchase_status is already well past 'Enquiry' by this
    # point (issuing a PO alone advances it, e.g. to 'Ordered'/'Transit') — that's the broader
    # procurement lifecycle, unrelated to the receive route's own partial-quantity tracking
    # (bom_item_receipts). The only thing a partial delivery must NOT do is flip it to 'Received'.
    receive(session, bom_id, supplier_id, 6, "GRN-A-1", "INV-A-1")
    item = get_bom_item(session, bom_id)
    check("Item A partial receipt: purchase_status NOT yet Received (only 6 of 10 in)",
          item and item.get("purchase_status") != "Received", f"purchase_status={item and item.get('purchase_status')}")

    approval_1 = get_pending_inward_approval(session, bom_id)
    check("Item A: an inward approval was created for the first delivery", approval_1 is not None,
          f"approval={approval_1 and approval_1['id']}")
    on_hand_before = get_inventory_on_hand(session, ITEM_A["item_id"])
    check("Item A: on_hand NOT credited while inward review is pending", on_hand_before in (None, 0),
          f"on_hand={on_hand_before}")

    decide_inward(session, approval_1["id"], "approved")
    on_hand_after_1 = get_inventory_on_hand(session, ITEM_A["item_id"])
    check("Item A: on_hand credited with the first 6 units after QC approval", on_hand_after_1 == 6,
          f"on_hand={on_hand_after_1}")

    # Second partial delivery: remaining 4.
    receive(session, bom_id, supplier_id, 4, "GRN-A-2", "INV-A-2")
    item = get_bom_item(session, bom_id)
    check("Item A: purchase_status flips to Received once the full qty is in",
          item and item.get("purchase_status") == "Received", f"purchase_status={item and item.get('purchase_status')}")

    approval_2 = get_pending_inward_approval(session, bom_id)
    decide_inward(session, approval_2["id"], "approved")
    on_hand_final = get_inventory_on_hand(session, ITEM_A["item_id"])
    check("Item A: on_hand reaches the full 10 units after both approvals", on_hand_final == 10,
          f"on_hand={on_hand_final}")

    return bom_id


def test_item_b_single_delivery_with_reject(session, supplier_id, node_id, check):
    """No delivery lots; one full delivery; rejected once, resubmitted, then approved."""
    bom_id = raise_scalar_item(session, ITEM_B, node_id)
    quote_id = log_quote(session, supplier_id, bom_id)
    po_id = select_supplier(session, bom_id, quote_id)
    issue_po(session, po_id)
    # deliberately no delivery-lots call here

    receive(session, bom_id, supplier_id, ITEM_B["qty"], "GRN-B-1", "INV-B-1")
    item = get_bom_item(session, bom_id)
    check("Item B: purchase_status flips to Received on the one full delivery",
          item and item.get("purchase_status") == "Received", f"purchase_status={item and item.get('purchase_status')}")

    approval = get_pending_inward_approval(session, bom_id)
    check("Item B: an inward approval was created", approval is not None, f"approval={approval and approval['id']}")

    decide_inward(session, approval["id"], "rejected", reason="Test rejection — visible damage on inspection")
    on_hand_after_reject = get_inventory_on_hand(session, ITEM_B["item_id"])
    check("Item B: on_hand NOT credited after rejection", on_hand_after_reject in (None, 0),
          f"on_hand={on_hand_after_reject}")

    resubmitted_id = resubmit_inward(session, approval["id"])
    decide_inward(session, resubmitted_id, "approved")
    on_hand_final = get_inventory_on_hand(session, ITEM_B["item_id"])
    check("Item B: on_hand credited with all 5 units once the resubmission is approved", on_hand_final == 5,
          f"on_hand={on_hand_final}")

    return bom_id


def verify_reserved_not_usable(check, bom_id_a, bom_id_b):
    """The whole point of the 2026-09-17 conversation: a 'bom'-sourced receipt must land as an
    active RESERVATION against its own bom_item, not sitting as generic usable stock any other
    project could grab. No JSON API exposes the reservations list, so this reads the real DB
    directly (same "verify at the data layer when no API exists" precedent this repo already
    uses elsewhere) rather than re-deriving the app's own business logic in Python."""
    for label, bom_id, expected_qty in [("Item A", bom_id_a, ITEM_A["qty"]), ("Item B", bom_id_b, ITEM_B["qty"])]:
        rows = turso_query(
            "SELECT qty, status FROM inventory_reservations WHERE bom_item_id = ? AND status = 'active'",
            [bom_id])
        total_reserved = sum(float(r["qty"]) for r in rows)
        check(f"{label}: fully reserved against its own project (not generic usable stock)",
              total_reserved == expected_qty, f"reserved={total_reserved}, expected={expected_qty}")


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
                        json={"project_id": PROJECT_ID, "name": "Phase2 Procurement"}), "create_node")

    print("Item A: raise -> quote -> select -> issue -> delivery lots -> 2 partial receives -> QC approve x2...")
    bom_id_a = test_item_a_with_delivery_lots(session, supplier["id"], node["id"], check)

    print("Item B: raise -> quote -> select -> issue -> single receive -> QC reject -> resubmit -> approve...")
    bom_id_b = test_item_b_single_delivery_with_reject(session, supplier["id"], node["id"], check)

    print("Verifying both items landed as RESERVED stock, not generic usable stock...")
    verify_reserved_not_usable(check, bom_id_a, bom_id_b)

    print("\n".join(report))
    print("\n" + ("ALL PASSED" if passed else "SOME FAILED"))
    return passed


if __name__ == "__main__":
    sys.exit(0 if run() else 1)
