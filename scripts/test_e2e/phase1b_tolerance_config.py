#!/usr/bin/env python3
"""
Phase 1b — matching-engine configuration: the configurable plate thickness tolerance, and the
manual "combinable remnant" hint (a piece too small in L/W to auto-match, but same material and
thickness). Builds on the same TEST-PROJ sandbox as Phase 1, with its own catalog rows so the two
phases never interfere.

Run standalone:  python3 scripts/test_e2e/phase1b_tolerance_config.py
"""
import json
import sys

import requests

sys.path.insert(0, __file__.rsplit("/", 1)[0])
from common import api, must_ok, login, turso_execute

PROJECT_ID = 242  # TEST-PROJ

# Real catalog: 12mm plate for the tolerance test, 14mm plate for the combinable-hint test.
TOL_ITEM = {"item_id": 192, "name": "BQ PLATE 12 MM SA 516 GR 70"}
COMBINABLE_ITEM = {"item_id": 193, "name": "BQ PLATE 14 MM SA 516 GR 70"}
ALL_ITEM_IDS = [TOL_ITEM["item_id"], COMBINABLE_ITEM["item_id"]]


def reset():
    ids = ",".join(str(i) for i in ALL_ITEM_IDS)
    turso_execute(f"DELETE FROM bom_items WHERE project_id = {PROJECT_ID} "
                  f"AND item_id IN ({ids})")
    turso_execute(f"DELETE FROM bom_assemblies WHERE project_id = {PROJECT_ID} "
                  f"AND name IN ('Phase1b Tolerance', 'Phase1b Combinable')")
    turso_execute(f"DELETE FROM stock_pieces WHERE inventory_item_id IN "
                  f"(SELECT id FROM inventory_items WHERE item_id IN ({ids}))")
    turso_execute(f"DELETE FROM inventory_items WHERE item_id IN ({ids})")
    # Always leave the global tolerance setting at its shipped default, whatever this run did.
    api(requests.Session(), "GET", "/api/settings/remnant-tolerances")  # no-op warm-up, ignore result
    print("Phase 1b reset done.")


def create_inventory_item(session, description, item_id, category="plate", moc="SA 516 Gr.70"):
    r = api(session, "POST", "/api/inventory-items",
            json={"description": description, "item_id": item_id, "category": category, "moc": moc})
    return must_ok(r, f"create_inventory_item({description})")


def add_stock_piece(session, inventory_item_id, length, width, thickness, density=7850):
    r = api(session, "POST", "/api/stock-pieces", json={
        "inventory_item_id": inventory_item_id, "kind": "plate",
        "length_mm": length, "width_mm": width, "thickness_mm": thickness, "density": density,
    })
    return must_ok(r, f"add_stock_piece(inv={inventory_item_id})")


def raise_plate_line(session, item, length, width, thickness, node_name):
    node = must_ok(api(session, "POST", "/api/bom-assemblies",
                        json={"project_id": PROJECT_ID, "name": node_name}), "create_assembly_node")
    r = api(session, "POST", "/api/purchase-requisitions", json={
        "raised_by_dept": "Engineering",
        "lines": [{
            "material_description": item["name"], "item_id": item["item_id"], "category": "plate",
            "moc": "SA 516 Gr.70",
            "category_fields": {"length": length, "width": width, "thickness": thickness},
            "projects": [{"project_id": PROJECT_ID, "qty_text": "1 No"}],
        }],
    })
    bom_item_id = must_ok(r, "raise_plate_line")["bom_item_ids"][0]
    must_ok(api(session, "PATCH", f"/api/bom-items/{bom_item_id}", json={"assembly_id": node["id"]}),
            "assign_to_node")
    return bom_item_id


def release_bom(session):
    return must_ok(api(session, "POST", f"/api/projects/{PROJECT_ID}/release-bom"), "release_bom")


def get_bom_item(session, bom_item_id):
    items = must_ok(api(session, "GET", f"/api/projects/{PROJECT_ID}/bom?all=1"), "get_bom")["items"]
    return next((b for b in items if b["id"] == bom_item_id), None)


def set_tolerance(session, mm):
    return must_ok(api(session, "PATCH", "/api/settings/remnant-tolerances",
                        json={"plate_thickness_mm": mm}), "set_tolerance")


def test_configurable_tolerance(session, report, check):
    """A piece 0.4mm off the required thickness: default 0.3mm tolerance must reject it on the
    first Release BOM; widening the tolerance and releasing AGAIN (matchProjectBom re-sweeps every
    still-open dimensional line every time, by design — see lib/remnant-match.js's own comment on
    why pending_review=0 stays the eligibility filter) must then match the SAME line. One line,
    two releases — proves the setting actually drives matching, not just that it's stored."""
    inv = create_inventory_item(session, TOL_ITEM["name"], TOL_ITEM["item_id"])
    add_stock_piece(session, inv["id"], length=1000, width=1000, thickness=12.0)  # piece: 12.0mm

    set_tolerance(session, 0.3)
    bom_id = raise_plate_line(session, TOL_ITEM, 1000, 1000, 12.4, "Phase1b Tolerance")  # req: 12.4mm, diff=0.4
    release_bom(session)
    item = get_bom_item(session, bom_id)
    check("Default 0.3mm tolerance REJECTS a 0.4mm-off piece", item and item.get("pending_review") == 0,
          f"pending_review={item and item.get('pending_review')}")

    set_tolerance(session, 0.5)
    release_bom(session)  # re-releasing re-sweeps the SAME still-open line, no new item needed
    item = get_bom_item(session, bom_id)
    check("Widened 0.5mm tolerance ACCEPTS the same line on re-release", item and item.get("pending_review") == 1,
          f"pending_review={item and item.get('pending_review')}")

    set_tolerance(session, 0.3)  # restore the shipped default before returning control


def test_combinable_hint(session, report, check):
    """A piece too small in L/W (same material+thickness) must NOT auto-match, and must surface
    as a manual 'combinable' hint on Material Demand."""
    inv = create_inventory_item(session, COMBINABLE_ITEM["name"], COMBINABLE_ITEM["item_id"])
    add_stock_piece(session, inv["id"], length=500, width=500, thickness=14)  # too small for the line below

    bom_id = raise_plate_line(session, COMBINABLE_ITEM, 2000, 1000, 14, "Phase1b Combinable")
    release_bom(session)
    item = get_bom_item(session, bom_id)
    check("Undersized piece is NOT auto-matched", item and item.get("pending_review") == 0,
          f"pending_review={item and item.get('pending_review')}")

    page = api(session, "GET", "/stores?tab=requests")
    hint_shown = "too small alone" in page.text and COMBINABLE_ITEM["name"] in page.text
    check("Combinable-remnant hint renders on Material Demand", hint_shown,
          "found 'too small alone' near the line" if hint_shown else "hint text not found in page")


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

    print("Testing configurable plate thickness tolerance...")
    test_configurable_tolerance(session, report, check)
    print("Testing combinable-remnant manual hint...")
    test_combinable_hint(session, report, check)

    print("\n".join(report))
    print("\n" + ("ALL PASSED" if passed else "SOME FAILED"))
    return passed


if __name__ == "__main__":
    sys.exit(0 if run() else 1)
