#!/usr/bin/env python3
"""
Phase 1 — Auto-reservation matching, against real TEST-PROJ (project 242) on the shared dev DB.

Scenario:
  - 2 scalar items with real inventory on hand -> should auto-reserve on Release BOM.
  - 2 scalar items with NO inventory -> should stay in Enquiry (normal procurement route).
  - 1 plate piece in stock sized EXACTLY to a PR line's requirement -> exact match, no waste.
  - 1 plate piece in stock slightly BIGGER than a PR line's requirement -> match with waste.

Run standalone:  python3 scripts/test_e2e/phase1_reservation.py
Rerun cleanly:   python3 scripts/test_e2e/phase1_reservation.py --reset-first
"""
import json
import sys

import requests

sys.path.insert(0, __file__.rsplit("/", 1)[0])
from common import api, must_ok, login, turso_execute, BASE

PROJECT_ID = 242  # TEST-PROJ

# Real Item Master catalog rows chosen ahead of time (no prior inventory against them).
SCALAR_MATCH_A = {"item_id": 1, "name": "AD-ON BLOCK 2NO-NC"}
SCALAR_MATCH_B = {"item_id": 2, "name": "AD ON BLOCK 1NO-NC"}
SCALAR_NOMATCH_A = {"item_id": 3, "name": "AIR NOZZLE CI, TF SERIES 25 MM TOP"}
SCALAR_NOMATCH_B = {"item_id": 4, "name": "AIR NOZZLE CI, FBC SERIES 50 MM TOP"}
PLATE_BIG = {"item_id": 190, "name": "BQ PLATE 8 MM SA 516 GR 70", "length": 2000, "width": 1000, "thickness": 10}
PLATE_SMALL = {"item_id": 191, "name": "BQ PLATE 10MM SA 516 GR 70", "length": 1200, "width": 600, "thickness": 10}
ALL_ITEM_IDS = [SCALAR_MATCH_A["item_id"], SCALAR_MATCH_B["item_id"], SCALAR_NOMATCH_A["item_id"],
                SCALAR_NOMATCH_B["item_id"], PLATE_BIG["item_id"], PLATE_SMALL["item_id"]]


def reset():
    """Wipes anything a prior run of this phase left behind, so it can be rerun cleanly.
    Scoped strictly to this phase's own item_ids/node name — TEST-PROJ is shared with sibling
    phases (2, 1b, ...), so a blanket `WHERE project_id = ...` delete here would also destroy
    THEIR still-live rows (a real bug found live: this used to do exactly that). Order matters
    too: Turso enforces foreign keys, so child rows (reservations/pieces/qc auto-records that
    point at a bom_item) must go before the bom_items row itself."""
    ids = ",".join(str(i) for i in ALL_ITEM_IDS)
    bom_id_sql = f"SELECT id FROM bom_items WHERE project_id = {PROJECT_ID} AND item_id IN ({ids})"
    turso_execute(f"DELETE FROM inventory_reservations WHERE bom_item_id IN ({bom_id_sql})")
    turso_execute(f"DELETE FROM qc_records WHERE bom_item_id IN ({bom_id_sql})")  # auto-created "Incoming Inspection" row, if any
    turso_execute(f"DELETE FROM stock_pieces WHERE inventory_item_id IN "
                  f"(SELECT id FROM inventory_items WHERE item_id IN ({ids}))")
    turso_execute(f"DELETE FROM bom_items WHERE project_id = {PROJECT_ID} AND item_id IN ({ids})")
    turso_execute(f"DELETE FROM bom_assemblies WHERE project_id = {PROJECT_ID} AND name = 'Test Assembly'")
    turso_execute(f"DELETE FROM inventory_items WHERE item_id IN ({ids})")
    print("Reset done: TEST-PROJ BOM cleared, test inventory rows removed.")


def create_inventory_item(session, description, item_id, on_hand=0, category=None,
                           moc=None, category_fields=None):
    body = {"description": description, "item_id": item_id, "on_hand": on_hand}
    if category:
        body["category"] = category
    if moc:
        body["moc"] = moc
    if category_fields:
        body["category_fields_json"] = json.dumps(category_fields)
    r = api(session, "POST", "/api/inventory-items", json=body)
    return must_ok(r, f"create_inventory_item({description})")


def add_stock_piece(session, inventory_item_id, length, width, thickness, density=7850):
    r = api(session, "POST", "/api/stock-pieces", json={
        "inventory_item_id": inventory_item_id, "kind": "plate",
        "length_mm": length, "width_mm": width, "thickness_mm": thickness, "density": density,
    })
    return must_ok(r, f"add_stock_piece(inv={inventory_item_id})")


def raise_pr(session, raised_by_dept, lines):
    r = api(session, "POST", "/api/purchase-requisitions",
            json={"raised_by_dept": raised_by_dept, "lines": lines})
    return must_ok(r, "raise_pr")


def create_assembly_node(session, project_id, name="Test Assembly"):
    r = api(session, "POST", "/api/bom-assemblies", json={"project_id": project_id, "name": name})
    return must_ok(r, f"create_assembly_node({name})")


def assign_to_node(session, bom_item_id, assembly_id):
    r = api(session, "PATCH", f"/api/bom-items/{bom_item_id}", json={"assembly_id": assembly_id})
    return must_ok(r, f"assign_to_node({bom_item_id})")


def release_bom(session, project_id):
    r = api(session, "POST", f"/api/projects/{project_id}/release-bom")
    return must_ok(r, "release_bom")


def get_bom(session, project_id):
    r = api(session, "GET", f"/api/projects/{project_id}/bom?all=1")
    return must_ok(r, "get_bom")["items"]


def setup_inventory(session):
    """Creates the 4 stock rows the reservation test needs."""
    create_inventory_item(session, SCALAR_MATCH_A["name"], SCALAR_MATCH_A["item_id"], on_hand=50)
    create_inventory_item(session, SCALAR_MATCH_B["name"], SCALAR_MATCH_B["item_id"], on_hand=50)

    inv_big = create_inventory_item(
        session, PLATE_BIG["name"], PLATE_BIG["item_id"], category="plate", moc="SA 516 Gr.70")
    add_stock_piece(session, inv_big["id"], PLATE_BIG["length"], PLATE_BIG["width"], PLATE_BIG["thickness"])

    inv_small = create_inventory_item(
        session, PLATE_SMALL["name"], PLATE_SMALL["item_id"], category="plate", moc="SA 516 Gr.70")
    add_stock_piece(session, inv_small["id"], PLATE_SMALL["length"], PLATE_SMALL["width"], PLATE_SMALL["thickness"])


def raise_bom_lines(session, project_id=PROJECT_ID):
    """Raises one PR carrying all 6 test lines, materializing straight to bom_items."""
    def scalar_line(item, qty_text):
        return {"material_description": item["name"], "item_id": item["item_id"], "category": "standard",
                "projects": [{"project_id": project_id, "qty_text": qty_text}]}

    def plate_line(item, length, width, thickness, qty_text="1 No"):
        return {"material_description": item["name"], "item_id": item["item_id"], "category": "plate",
                "moc": "SA 516 Gr.70", "category_fields": {"length": length, "width": width, "thickness": thickness},
                "projects": [{"project_id": project_id, "qty_text": qty_text}]}

    lines = [
        scalar_line(SCALAR_MATCH_A, "5 Nos"),
        scalar_line(SCALAR_MATCH_B, "3 Nos"),
        scalar_line(SCALAR_NOMATCH_A, "10 Nos"),
        scalar_line(SCALAR_NOMATCH_B, "7 Nos"),
        plate_line(PLATE_BIG, PLATE_BIG["length"], PLATE_BIG["width"], PLATE_BIG["thickness"]),
        # deliberately smaller than the 1200x600 piece in stock -> should match with waste
        plate_line(PLATE_SMALL, 1100, 550, PLATE_SMALL["thickness"]),
    ]
    result = raise_pr(session, "Engineering", lines)
    return result["bom_item_ids"]


def verify(session, project_id=PROJECT_ID):
    """Checks the post-release-BOM state against expectations. Returns (passed, report_lines)."""
    bom = get_bom(session, project_id)
    by_desc = {}
    for b in bom:
        by_desc.setdefault(b["material_description"], []).append(b)

    report = []
    passed = True

    def check(label, condition, detail):
        nonlocal passed
        status = "PASS" if condition else "FAIL"
        if not condition:
            passed = False
        report.append(f"[{status}] {label}: {detail}")

    def one(desc):
        rows = by_desc.get(desc)
        return rows[0] if rows else None

    a, b_ = one(SCALAR_MATCH_A["name"]), one(SCALAR_MATCH_B["name"])
    na, nb = one(SCALAR_NOMATCH_A["name"]), one(SCALAR_NOMATCH_B["name"])
    pbig, psmall = one(PLATE_BIG["name"]), one(PLATE_SMALL["name"])

    check("Scalar A auto-reserved from stock", a and a.get("pending_review") == 1,
          f"pending_review={a and a.get('pending_review')}")
    check("Scalar B auto-reserved from stock", b_ and b_.get("pending_review") == 1,
          f"pending_review={b_ and b_.get('pending_review')}")
    check("Scalar no-match A left for normal procurement", na and na.get("pending_review") == 0,
          f"pending_review={na and na.get('pending_review')}")
    check("Scalar no-match B left for normal procurement", nb and nb.get("pending_review") == 0,
          f"pending_review={nb and nb.get('pending_review')}")
    check("Plate BIG (exact-fit piece) matched", pbig and pbig.get("pending_review") == 1,
          f"pending_review={pbig and pbig.get('pending_review')}")
    check("Plate SMALL (oversized piece, matched with waste) matched",
          psmall and psmall.get("pending_review") == 1, f"pending_review={psmall and psmall.get('pending_review')}")

    return passed, report


def run(do_reset=True):
    if do_reset:
        reset()
    session = requests.Session()
    print("Logging in as admin...")
    login(session)

    print("Creating inventory (2 scalar + 2 plate pieces)...")
    setup_inventory(session)

    print("Raising PR with 6 BOM lines...")
    ids = raise_bom_lines(session)
    print(f"  bom_item_ids: {ids}")

    print("Assigning all lines to a structure node (release-bom requires it)...")
    node = create_assembly_node(session, PROJECT_ID)
    for bom_item_id in ids:
        assign_to_node(session, bom_item_id, node["id"])

    print("Releasing BOM to trigger matchProjectBom + matchProjectPlainStock...")
    release_bom(session, PROJECT_ID)

    print("Verifying...")
    passed, report = verify(session, PROJECT_ID)
    print("\n".join(report))
    print("\n" + ("ALL PASSED" if passed else "SOME FAILED"))
    return passed


if __name__ == "__main__":
    sys.exit(0 if run() else 1)
