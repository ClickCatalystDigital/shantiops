#!/usr/bin/env python3
"""
Phase T -- Trade (SAS) workflow: Sales raises a trade request against a Sale Order (no project
demand involved), Stores fulfils it -- either straight from existing usable stock, or by routing it
through Procurement when it isn't -- and once material is in hand it goes to Dispatch with a
packing list. Self-contained: does not depend on any other phase having run.

Two SAS lines against one real Sale Order, deliberately testing both branches the user described:
  - Item A (item_id 7): usable stock already exists -> Stores' auto-allocation reserves it straight
    away, at raise time, WITHOUT ever going near Procurement (pending_review flips to 1). Stores
    then Issues the reservation (the real "hand it out" action) so it's actually ready to pack.
    This branch only actually fires when Stores' allocation mode is 'auto'
    (app/api/purchase-requisitions/route.js) -- run() forces that mode on and restores whatever it
    found afterward, since it's a real, persisted, app-wide setting, not test-scoped data.
  - Item B (item_id 8): no existing stock -> stays visible to Procurement (pending_review stays 0,
    same Enquiry queue a normal BOM line would land in) -> quote -> select -> issue PO -> receive ->
    QC inward approval, exactly like Phase 2's regular procurement route.

    THIS is where the real gap found in Phase 2's investigation lived: lib/bom-receiving.js's
    scalar-crediting logic used to only handle source='bom' (reserve to project) and
    source='stock' (credit to free stock) -- a freshly-procured source='sas' item fell through both
    and was silently lost (never credited to on_hand, never reserved) the moment QC approved it.
    Fixed in this same session (lib/bom-receiving.js's maybeReserveScalarStock now also handles
    'sas', reserving against the sas bom_item itself -- the real demand context (sale_order_no)
    already lives on that row, so this genuinely is "reserve to the trade request"). This phase
    proves the fix, not just the workflow.

Both items then go to Dispatch: a draft packing list generated from the sentinel system project's
BOM (source='stock'/'sas' items never belong to a real project -- they park on the one shared
sentinel project, is_system=1, and flow through Procurement/Dispatch's ordinary tabs from there,
labelled by their own sale_order_no rather than a project number), packed, submitted for the dual
QC + Production pre-dispatch sign-off, approved both sides, dispatched.

Sales-department notification on status changes is explicitly out of scope for now (per the
2026-09-17 conversation this phase was speced from) -- not tested here.

Run standalone:  python3 scripts/test_e2e/phaseT_sas_trade.py
"""
import sys

import requests

sys.path.insert(0, __file__.rsplit("/", 1)[0])
from common import api, must_ok, login, turso_execute, turso_query

ITEM_A = {"item_id": 7, "name": "APH TUBE BS6323 PART V OD 28.40 X 2.34 TH X 6.1 MTR", "qty": 6, "existing_stock": 20}
ITEM_B = {"item_id": 8, "name": "APH TUBE BS6323 PART V OD 38.10 X 2.34 TH X 6.1 MTR", "qty": 4}
ALL_ITEM_IDS = [ITEM_A["item_id"], ITEM_B["item_id"]]
SUPPLIER_NAME = "ZZ-PHASET-TEST-SUPPLIER (safe to delete)"
CUSTOMER_TAG = "ZZ-PHASET-TEST-CUSTOMER (safe to delete)"


def get_sentinel_project_id():
    """No JSON API exposes the sentinel system project's id -- same 'read directly, never write'
    precedent Phase 2/3 already use for tables/lookups with no JSON API."""
    row = turso_query("SELECT id FROM projects WHERE is_system = 1 LIMIT 1")
    if not row:
        raise RuntimeError("No sentinel system project found (is_system = 1) -- can't run Phase T")
    return int(row[0]["id"])


def reset():
    sentinel_id = get_sentinel_project_id()
    ids = ",".join(str(i) for i in ALL_ITEM_IDS)
    bom_id_sql = f"SELECT id FROM bom_items WHERE project_id = {sentinel_id} AND item_id IN ({ids})"
    turso_execute("DELETE FROM pre_dispatch_approvals WHERE packing_list_id IN "
                   "(SELECT DISTINCT pi.packing_list_id FROM packing_items pi "
                  f"  WHERE pi.bom_item_id IN ({bom_id_sql}))")
    turso_execute("DELETE FROM packing_lists WHERE id IN "
                   "(SELECT DISTINCT pi.packing_list_id FROM packing_items pi "
                  f"  WHERE pi.bom_item_id IN ({bom_id_sql}))")
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
    turso_execute(f"DELETE FROM bom_items WHERE project_id = {sentinel_id} AND item_id IN ({ids})")
    turso_execute(f"DELETE FROM inventory_items WHERE item_id IN ({ids})")
    turso_execute("DELETE FROM stock_receipts WHERE supplier_id IN "
                  f"(SELECT id FROM suppliers WHERE name = '{SUPPLIER_NAME}')")
    turso_execute(f"DELETE FROM suppliers WHERE name = '{SUPPLIER_NAME}'")
    turso_execute(f"DELETE FROM sale_orders WHERE customer_name = '{CUSTOMER_TAG}'")
    print("Phase T reset done.")


def create_sale_order(session):
    r = api(session, "POST", "/api/sale-orders", json={"customer_name": CUSTOMER_TAG, "description": "Phase T test SAS order"})
    return must_ok(r, "create_sale_order")


def create_supplier(session):
    return must_ok(api(session, "POST", "/api/suppliers", json={"name": SUPPLIER_NAME}), "create_supplier")


def create_inventory_item(session, item, on_hand):
    r = api(session, "POST", "/api/inventory-items", json={
        "description": item["name"], "item_id": item["item_id"], "on_hand": on_hand,
    })
    return must_ok(r, "create_inventory_item")


def raise_sas(session, item, so_no):
    r = api(session, "POST", "/api/purchase-requisitions", json={
        "raised_by_dept": "Sales",
        "lines": [{
            "source": "sas", "material_description": item["name"], "item_id": item["item_id"],
            "sale_order_no": so_no, "qty_text": f"{item['qty']} Nos",
        }],
    })
    return must_ok(r, "raise_sas")["bom_item_ids"][0]


def get_bom_item_row(bom_id):
    row = turso_query("SELECT * FROM bom_items WHERE id = ?", [bom_id])
    return row[0] if row else None


def get_inventory_on_hand(session, item_id):
    items = must_ok(api(session, "GET", "/api/inventory-items"), "get_inventory_items")
    row = next((i for i in items if i.get("item_id") == item_id), None)
    return row["on_hand"] if row else None, row["id"] if row else None


def set_not_manufactured(session, bom_id):
    """Direct-to-dispatch trade material never touches Production -- Engineering-owned field, a
    real PATCH through the generic bom-items route, not a bypass."""
    return must_ok(api(session, "PATCH", f"/api/bom-items/{bom_id}", json={"requires_manufacturing": False}),
                    "set_not_manufactured")


def get_allocation_mode(session):
    return must_ok(api(session, "GET", "/api/settings/allocation-mode"), "get_allocation_mode")["mode"]


def set_allocation_mode(session, mode):
    return must_ok(api(session, "PATCH", "/api/settings/allocation-mode", json={"mode": mode}), "set_allocation_mode")


def run(do_reset=True):
    if do_reset:
        reset()
    session = requests.Session()
    login(session)
    sentinel_id = get_sentinel_project_id()

    # Item A's whole premise -- existing stock auto-reserves at raise time -- only fires when
    # Stores' allocation mode is 'auto' (app/api/purchase-requisitions/route.js). This is a real,
    # persisted, app-wide setting (app_settings.stores_allocation_mode), not test-scoped data --
    # save whatever it was and restore it, don't just leave it changed.
    original_mode = get_allocation_mode(session)
    if original_mode != "auto":
        set_allocation_mode(session, "auto")

    report = []
    passed = True

    def check(label, condition, detail):
        nonlocal passed
        status = "PASS" if condition else "FAIL"
        if not condition:
            passed = False
        report.append(f"[{status}] {label}: {detail}")

    try:
        so = create_sale_order(session)
        print(f"Sale Order {so['so_no']} created.")

        print("Item A: seeding existing usable stock, then Sales raises a SAS request against it...")
        create_inventory_item(session, ITEM_A, on_hand=ITEM_A["existing_stock"])
        bom_a = raise_sas(session, ITEM_A, so["so_no"])
        item_a = get_bom_item_row(bom_a)
        check("Item A: Stores fulfilled it straight from usable stock -- never went to Procurement (pending_review=1)",
              item_a and item_a["pending_review"] == 1, f"pending_review={item_a and item_a['pending_review']}")
        reservation_a = turso_query(
            "SELECT id, qty FROM inventory_reservations WHERE bom_item_id = ? AND status = 'active'", [bom_a])
        check("Item A: fully reserved against the trade request from existing stock",
              bool(reservation_a) and float(reservation_a[0]["qty"]) == ITEM_A["qty"], f"reservation={reservation_a}")

        if reservation_a:
            print("Item A: Stores Issues the reservation (the real hand-out action, on_hand decrements, item -> In-Stock)...")
            must_ok(api(session, "POST", f"/api/inventory-reservations/{reservation_a[0]['id']}/issue"), "issue_reservation")
            item_a_after_issue = get_bom_item_row(bom_a)
            check("Item A: purchase_status -> In-Stock once issued", item_a_after_issue["purchase_status"] == "In-Stock",
                  f"purchase_status={item_a_after_issue['purchase_status']}")
            on_hand_a, _ = get_inventory_on_hand(session, ITEM_A["item_id"])
            check("Item A: on_hand decremented by the issued qty", on_hand_a == ITEM_A["existing_stock"] - ITEM_A["qty"],
                  f"on_hand={on_hand_a}, expected={ITEM_A['existing_stock'] - ITEM_A['qty']}")
        set_not_manufactured(session, bom_a)

        print("Item B: no existing stock -> Sales raises a SAS request that Stores can't fulfil...")
        bom_b = raise_sas(session, ITEM_B, so["so_no"])
        item_b = get_bom_item_row(bom_b)
        check("Item B: NOT fulfilled from stock -- correctly requested from Procurement (pending_review=0, visible in Enquiry)",
              item_b and item_b["pending_review"] == 0, f"pending_review={item_b and item_b['pending_review']}")
        check("Item B: still in Enquiry, no reservation made", item_b["purchase_status"] == "Enquiry",
              f"purchase_status={item_b['purchase_status']}")

        print("Item B: Procurement's regular route -- quote -> select -> issue PO -> receive -> QC approve...")
        supplier = create_supplier(session)
        quote_id = must_ok(api(session, "POST", "/api/supplier-quotes",
                                json={"supplier_id": supplier["id"], "items": [{"bom_item_id": bom_b, "unit_price": 75}]}),
                            "log_quote")["ids"][0]
        po_id = must_ok(api(session, "POST", f"/api/bom-items/{bom_b}/select-supplier", json={"quote_id": quote_id}),
                         "select_supplier")["po_id"]
        must_ok(api(session, "PATCH", f"/api/purchase-orders/{po_id}", json={"action": "issue"}), "issue_po")
        must_ok(api(session, "POST", f"/api/bom-items/{bom_b}/receive", json={
            "qty_text": str(ITEM_B["qty"]),
            "receipt": {"supplier_id": supplier["id"], "grn_ref": "GRN-PT-B", "invoice_no": "INV-PT-B"},
        }), "receive")
        item_b_received = get_bom_item_row(bom_b)
        check("Item B: purchase_status -> Received on the full delivery", item_b_received["purchase_status"] == "Received",
              f"purchase_status={item_b_received['purchase_status']}")

        approvals = must_ok(api(session, "GET", "/api/inward-approvals"), "get_pending_inward_approvals")
        approval = next(a for a in approvals if a["bom_item_id"] == bom_b and a["status"] == "pending")
        on_hand_before, _ = get_inventory_on_hand(session, ITEM_B["item_id"])
        check("Item B: on_hand NOT credited while inward review is pending", on_hand_before in (None, 0),
              f"on_hand={on_hand_before}")

        print("Item B: QC approves the delivery -- this is exactly where the real sas-receiving gap lived...")
        must_ok(api(session, "POST", f"/api/inward-approvals/{approval['id']}/decide", json={"decision": "approved"}),
                "decide_inward")
        on_hand_after, inv_id_b = get_inventory_on_hand(session, ITEM_B["item_id"])
        check("FIX VERIFIED: Item B's on_hand is credited after QC approval (was silently lost before the fix)",
              on_hand_after == ITEM_B["qty"], f"on_hand={on_hand_after}, expected={ITEM_B['qty']}")
        reservation_b = turso_query(
            "SELECT qty FROM inventory_reservations WHERE bom_item_id = ? AND status = 'active'", [bom_b])
        check("FIX VERIFIED: Item B is fully reserved against its own trade request (not generic usable stock)",
              bool(reservation_b) and float(reservation_b[0]["qty"]) == ITEM_B["qty"], f"reservation={reservation_b}")
        set_not_manufactured(session, bom_b)

        print("Both items now go to Dispatch: generate a draft packing list from the sentinel project's BOM...")
        pl = must_ok(api(session, "POST", "/api/packing/from-bom", json={"project_id": sentinel_id}), "packing_from_bom")
        list_id = pl["id"]
        packed_bom_ids = {r["bom_item_id"] for r in turso_query(
            "SELECT bom_item_id FROM packing_items WHERE packing_list_id = ?", [list_id])}
        check("Packing list picked up both trade items", {bom_a, bom_b} <= packed_bom_ids,
              f"packed_bom_ids={packed_bom_ids}, expected to include {{{bom_a}, {bom_b}}}")

        print("Packing -> submit for pre-dispatch review -> QC + Production both approve -> dispatch...")
        must_ok(api(session, "PATCH", f"/api/packing/{list_id}", json={"status": "packed"}), "mark_packed")
        submission = must_ok(api(session, "POST", f"/api/packing/{list_id}/submit-for-approval"), "submit_for_approval")
        must_ok(api(session, "POST", f"/api/pre-dispatch-approvals/{submission['id']}/decide",
                    json={"decision": "approved", "role": "qc"}), "decide_qc")
        must_ok(api(session, "POST", f"/api/pre-dispatch-approvals/{submission['id']}/decide",
                    json={"decision": "approved", "role": "production"}), "decide_production")
        must_ok(api(session, "PATCH", f"/api/packing/{list_id}", json={"status": "dispatched"}), "dispatch")

        final = turso_query("SELECT status, dispatched_at FROM packing_lists WHERE id = ?", [list_id])[0]
        check("Packing list reaches 'dispatched' with both trade items on it",
              final["status"] == "dispatched" and final["dispatched_at"], f"final={final}")
    finally:
        if original_mode != "auto":
            set_allocation_mode(session, original_mode)

    print("\n".join(report))
    print("\n" + ("ALL PASSED" if passed else "SOME FAILED"))
    return passed


if __name__ == "__main__":
    sys.exit(0 if run() else 1)
