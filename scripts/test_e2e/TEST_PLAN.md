# shanti-ops E2E test suite — Stores/Procurement/Production/Dispatch lifecycle

Real Python tests against the actual running dev server and the real shared Turso dev DB, scoped
to project **TEST-PROJ** (id 242) so they never touch real customer data. Each phase creates real
rows through the real API, asserts against real state, and cleans up after itself. Not a mocked
test suite — this exercises the same code paths a real user click-through would.

**Where things live:** `scripts/test_e2e/`
- `common.py` — shared login/API helpers, plus `turso_execute`/`turso_query` for direct DB
  read/reset when no JSON API exists for something (documented per-use, not a shortcut around the
  app's own logic — only used for setup/reset/verification, never to bypass a real endpoint).
- `reset_all.py` — wipes every phase's test data in one call, safe from any partial/interrupted
  state. Add one import line here per new phase.
- `phaseN_*.py` — one file per phase, each with its own `reset()` and `run()`, runnable standalone.

**How to run one phase:** `python3 scripts/test_e2e/phaseN_name.py`
**How to reset everything:** `python3 scripts/test_e2e/reset_all.py`

Update the checkboxes below as phases land — this file is the map for picking the work back up in
a fresh chat.

---

## ✅ Phase 1 — Auto-reservation matching (`phase1_reservation.py`)

**Status: COMPLETE, all 6 checks passing.**

Tests `lib/remnant-match.js`'s auto-match engine, triggered by Release BOM:
- 2 scalar items with real inventory on hand → auto-reserved (`inventory_reservations`).
- 2 scalar items with no inventory → correctly left alone for normal procurement.
- 1 plate piece sized exactly to a requirement → exact match.
- 1 plate piece bigger than a requirement → matched with waste (rotation/L≥W fit rule, verified
  against the real `THICKNESS_TOLERANCE_MM`/L×W logic in `lib/remnant-match.js`).

## ✅ Phase 1b — Matching-engine configuration (`phase1b_tolerance_config.py`)

**Status: COMPLETE, all 4 checks passing.**

Built from a live product conversation (2026-09-17) about making the matching engine
configurable rather than hardcoded. Covers:
- The plate thickness tolerance is now a real, persisted, admin-editable setting
  (`app_settings.remnant_match_tolerances`), not a hardcoded `0.3mm` constant — proved by widening
  it and watching a previously-rejected piece get matched on re-release.
- L/W fit stays **mandatory** for auto-reservation (deliberately not made configurable — see the
  design discussion below) — but a piece that's the right material/thickness and just too small
  now surfaces as a manual "combinable remnant" hint on Material Demand, never auto-reserved.
- Confirmed no equivalent tolerance is needed for angle/beam/channel/pipe — those match on an
  exact profile designation + length, a discrete catalog spec with nothing to loosen.
- UI: the Auto/Manual allocation toggle moved from Inventory to Material Demand (where its effect
  is actually visible), combined with the tolerance setting under one "Match settings" cog, with a
  short "how auto-match works" explainer per material type.

**Design decision on record:** turning off the L/W size check was explicitly rejected — it would
silently auto-reserve a piece too small to fulfill the requirement without extra fabrication
(cutting + welding), which is a real decision for a human to make consciously, never something an
unattended matcher should assume.

## ✅ Phase 2 — Regular procurement route (`phase2_procurement.py`)

**Status: COMPLETE, all 12 checks passing.**

For the 2 scalar items Phase 1 proved go to normal procurement (no auto-match), walks the real
route: raise → log a supplier quote → select supplier (auto-drafts a PO) → issue the PO → receive
→ QC inward approval. Two items, deliberately exercising both receiving shapes:
- **Item A** — PO Delivery Lots configured (a real dated, partial-quantity delivery schedule,
  `lib/data.js`'s `po_delivery_lots`), received in two partial deliveries, each getting its own
  inward-approval cycle.
- **Item B** — no delivery lots, one single full delivery, deliberately including a QC **rejection**
  → resubmission → approval cycle (not just the happy path).

**The core question this phase answers** (raised directly in conversation before building it):
does received material for a real project's BOM line land as *reserved* stock tied to that
project, or does it become generic *usable* stock anyone could grab? Verified against the real
`inventory_reservations` table (no JSON API exposes this list, so read directly via
`turso_query` — documented in the script) that a `source='bom'` receipt is **fully reserved
against its own bom_item**, never left as free stock, the moment QC approves.

**Real finding from this investigation, not yet fixed:** `source='sas'` (Sales trade requests)
receipts have a genuine gap — `lib/bom-receiving.js`'s scalar-crediting logic only handles
`source='bom'` (reserve to project) and `source='stock'` (credit to free stock); `sas` falls
through both and the received material is neither credited nor reserved. Deferred to **Phase T**
below by explicit decision (2026-09-17) — SAS/trade is a separate workflow, tested and fixed on
its own.

## ✅ Phase 3 — Stores Allocate: routing to Production vs Dispatch (`phase3_stores_allocate.py`)

**Status: COMPLETE, all 14 checks passing.**

Two items, both raised/quoted/selected/issued/received/QC-approved via the same self-contained
route Phase 2 proves works (no dependency on Phase 2 having run first):
- **Item PROD** — routed to Production via `route-self`. Confirmed it shows up on Production's own
  cross-project Material Indent worklist. Production raises a real **Material Indent** against it →
  the indent's PDF renders (the physical handoff document to Stores) → Stores **releases** the full
  quantity → confirmed at the data layer: a real `material_issues` row for the full quantity, the
  indent item + header both roll up to `released`, and the underlying `inventory_reservations` row
  moves to `qty_issued == qty` with `status='issued'`.
- **Item DISP** — routed to Dispatch via `route-self`. Confirmed `self_routed_to='dispatch'` on the
  project's own BOM view, confirmed it does **not** appear on Production's worklist, and confirmed
  attempting to indent it is correctly **rejected** (`"...not routed to Production yet — Stores must
  route it before it can be indented"`). Full packing-list generation stays Phase 5's job.

**Real bug found — in the test itself, not the app.** The first run's final assertion queried
`inventory_reservations WHERE status = 'active'` and got nothing back, because a reservation that's
been fully consumed correctly moves to `status='issued'` — the app was right, the test's stale
filter was excluding the very row it needed. Verified directly against the DB
(`qty=8, qty_issued=8, status='issued'`) before touching the app, then fixed the test's own query
(drop the `status='active'` filter, assert `status='issued'` instead). Re-ran clean, all 14 pass.
Test artifacts cleaned up afterward via `reset()`.

## ⬜ Phase 4 — Production / WIP (not started)

Job Cards against the routed-to-Production items (and the Material Indent → Stores-release flow
from Phase 3 above, once material is actually in WIP): create a job card, log time, mark it done,
confirm `production_done` flips and the item becomes ready for packing. Also covers the
QC hold-point gate (`requires_qc_hold`/`qc-release`) if a route step names a `quality_checkpoint`.

## ⬜ Phase 5 — Dispatch / Packing (not started)

**Blocked on an open design decision, not a testing gap**: the packing list's own format/layout
needs to be defined first. The user has a reference Excel format for this — needs to be shared and
the packing list design finalized before this phase can be meaningfully tested (a generic "add
items to a list" test would prove nothing about whether the real layout is right).

Once the format is settled: generate a draft packing list from BOM, add items (including the
Dispatch-routed items from Phase 3), submit for pre-dispatch approval (QC + Production dual
sign-off), approve both sides, dispatch. Confirms the full chain closes: a BOM line raised in
Phase 1/2 ends up on a real, correctly-formatted, dispatched packing list.

---

## ⬜ Phase T — Trade (SAS) workflow (after all numbered phases above)

Separate from the main BOM lifecycle by explicit decision (2026-09-17) — Sales raises an SAS request against a Sale Order; Design is not involved. Each SAS request line is uniquely tracked by its bom_items.id, while sale_order_no identifies the parent Sale Order. Stores fulfills the request first from existing usable stock; only when sufficient usable stock is unavailable does the requirement flow to Procurement. Must include:
- Two explicit fulfillment branches: (A) an SAS item with sufficient existing usable Stores inventory → auto-reserve that stock and bypass Procurement; (B) an SAS item with insufficient/no usable stock → Stores requests Procurement, then quote → supplier selection → PO → delivery → QC inward approval → reserve the received material against the original SAS request → Dispatch/packing list.
- **Fixing the real gap found in Phase 2's investigation**: a freshly-procured `source='sas'`
  scalar item currently isn't credited to `on_hand` or reserved on receipt at all — the material
  arrives but the system loses track of it. Fix `lib/bom-receiving.js` to handle `sas` the same
  way `bom` is handled (reserve to the sale order / trade request), then test it.

## ⬜ Phase M — Master/Child (multi-unit split) via Allocation & Routing (last, after Phase T)

Everything above assumes a plain, single-unit project. Phase M repeats the relevant parts of the
lifecycle (allocation, routing, indenting, packing) for a real **master/child multi-unit split
order** — the harder case where one master BOM covers N physical units and Stores allocates
per-child before routing (`bom_item_child_allocations`/`bom_item_child_routing`, the
Allocation & Routing module's own multi-unit machinery, distinct from the single-project
`route-self` path Phase 3 covers). Deliberately scheduled last — it's a real, separate mode of the
same modules Phases 1-5 already prove work correctly in the simple case, so it only needs to test
the master/child-specific behavior on top, not re-prove everything from scratch.

---

## Known, deliberate design decisions (don't re-litigate these)

- **L/W plate fit is not configurable** — see Phase 1b. Only the thickness tolerance is.
- **No generic tolerance for angle/beam/channel/pipe** — their identity is a discrete profile
  designation, not a measured dimension; nothing to configure.
- **`matchProjectBom` re-sweeps every still-open dimensional line on every Release BOM click** —
  by design (so new stock or a widened tolerance can retroactively match an old line), not a bug.
  A test that raises a second line expecting it to win a race against an older still-open line
  will be surprised by this — see Phase 1b's own test-design fix for the concrete example.

- **`reset()` cleanup order is a real recurring trap, not just a Phase 2 quirk** — Turso enforces
  foreign keys on this connection. Phase 2's `reset()` needed 4 rounds of fixes to find every real
  table pointing at a test `bom_item`/`supplier`: `qc_records` (an "Incoming Inspection" row is
  auto-created on every receipt), `stock_receipts` (created per delivery, references the supplier),
  and `purchase_requisitions.awarded_supplier_id` (nulled, not deleted — the orphaned PR header is
  harmless, same precedent this app's own history already accepts). When writing a new phase's
  `reset()`, don't guess the reference list from memory — query it directly:
  `PRAGMA foreign_key_list(<table>)` across every real table, the same way this was actually
  debugged, before assuming a cleanup script is complete.
