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

## ✅ Phase 4 — Production / WIP (`phase4_production_wip.py`)

**Status: COMPLETE, all 15 checks passing.**

Two items, both raised/procured/received/QC-approved/routed to Production the same self-contained
way earlier phases already prove works:
- **Item NOHOLD** — the plain path. A Job Card is created **directly** against a real Production
  milestone — **no Work Order needed** for this (a Work Order is a separate, optional
  production-control layer above Job Cards, not the same thing as a Project; confirmed live). A
  Material Indent raised **with a `job_card_id`** correctly links the resulting `material_issues`
  row back to the Job Card that drew the material — a real, already-working linkage Phase 3 never
  exercised (it never touched Job Cards). Time logged → card marked `progress` → `done` → its
  milestone auto-completes. Production then **manually** flips `production_done` — confirmed this
  is a deliberate design choice, not a gap (a finished Job Card doesn't auto-imply 100% of the
  physical work is done; there's an explicit code comment saying so). Item then correctly reads as
  ready for packing.
- **Item HOLD** — the QC hold-point branch, which genuinely does need a real Work Order:
  `requires_qc_hold` can only ever be set by `generate-job-cards` off a route step's own
  `quality_checkpoint` — a plain Job Card has no field for it at all. Built a real Work Order → one
  route step naming a checkpoint → released → generated its Job Card (confirmed `requires_qc_hold=1`
  on it) → confirmed marking it `done` is **blocked** (400, "Held for QC") → QC releases the hold →
  now completes → milestone auto-completes → same manual `production_done` confirmation → ready.

**Closes the loop on "does it reach the packing list" — no new module needed.** Once both items were
marked ready, called `POST /api/packing/from-bom` — the exact same action Dispatch's own "Generate
Draft Packing List" button uses, already proven end-to-end (through to a real dispatch) by Phase T.
Both items correctly landed on the generated draft list.

**One real bug found — in the test's own `reset()`, not the app.** A Work-Order-generated Job Card
never gets a `notes` value at all (confirmed by reading `generate-job-cards/route.js`'s INSERT
directly — no `notes` column in it), so `reset()`'s original `WHERE notes = TAG` filter silently
missed that one Job Card — leaving it (and its time logs) around to throw a real FK error when the
Work Order it pointed at was deleted next. Exactly the class of trap this file's own note below
already warns about. Fixed by also matching on `work_order_id`. Verified clean on retry, zero
residue confirmed across every touched table.

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

## ✅ Phase T — Trade (SAS) workflow (`phaseT_sas_trade.py`)

**Status: COMPLETE, all 12 checks passing.**

Separate from the main BOM lifecycle by explicit decision (2026-09-17) — Sales raises an SAS
request against a Sale Order; Design is not involved. Both branches proven:
- **Item A** (existing usable stock) — auto-reserved straight away at raise time, never touches
  Procurement (`pending_review=1`). Stores then **Issues** the reservation → `purchase_status` →
  `In-Stock`, `on_hand` decremented by the issued qty.
- **Item B** (no existing stock) — stays visible to Procurement (`pending_review=0`, real Enquiry
  queue) → quote → select supplier → issue PO → receive → QC inward approval. **This is exactly
  where the real gap Phase 2's investigation found lived**: `on_hand` correctly stays uncredited
  while the inward review is pending, and — the fix under test — is correctly credited **and**
  reserved against its own trade request the moment QC approves (previously silently lost).

Both items then converge onto one draft packing list generated from the sentinel system project's
BOM, packed, dual QC+Production pre-dispatch sign-off, dispatched.

**The real fix, already landed**: `lib/bom-receiving.js`'s `maybeReserveScalarStock` now handles
`source='sas'` the same way `source='bom'` is handled (reserve to the trade request), closing the
gap where a freshly-procured SAS item used to arrive and then vanish (never credited, never
reserved). This phase is what proves that fix.

**Two real bugs found while running this — both in the test harness, not the app:**
1. **Item A's whole premise needs Stores' allocation mode set to `auto`** — the shared dev DB was
   sitting in `manual` mode (confirmed via `app_settings.stores_allocation_mode`), under which
   `autoReserveFromStock` never fires at all on insert, regardless of available stock. `run()` now
   saves whatever mode it found, forces `auto` for the duration, and restores the original mode in
   a `finally` block — since this is a real, persisted, app-wide setting, not test-scoped data.
2. **`common.py`'s `turso_query()` was returning INTEGER columns as JSON strings** (Turso's HTTP
   pipeline/Hrana API encodes them that way to avoid 64-bit precision loss over JSON), while the
   app's own JSON API returns real ints for the same values — so every check comparing a
   `turso_query()` row's id/flag column against an int from the API (`pending_review == 1`, a
   `bom_item_id` set-membership check) silently always failed, even when the underlying data was
   exactly right. Fixed at the root in `common.py` (`_coerce_cell`, coerces `type: "integer"` cells
   to real Python ints) rather than patching each phase's own comparisons — this bug would have hit
   every future phase that reads an integer column via `turso_query` and compares it against
   anything from the app's API.

Test artifacts cleaned up afterward via `reset()`.

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
