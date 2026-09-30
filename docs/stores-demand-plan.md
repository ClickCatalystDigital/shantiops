# Stores "Demand" rebuild — plan for a fresh chat (written 2026-10-01, nothing built yet)

Goal: replace the old Demand tab in Stores with a project-first view powered by the existing
Material Plan coverage engine, then retire the old Demand card. **Do not build a second coverage
calculation.** Do not touch the other Planning tabs (Schedule/Capacity/Cut/Backlog) — the owner
will rework Planning separately. Read `SYSTEM.md` §5e/§5bw/§5dn only if needed.

## Decisions already made (by the owner)
- Stores sees **released BOM lines only** (release_bom milestone done, or PR-raised / stock lines).
- Window: default = projects whose **need-by ≤ today + 14 days** (includes already-started/overdue),
  user can change it. Need-by = first Production milestone `planned_start` (else earliest milestone
  end) — already what `lib/plan-coverage.js` does. 12 of 13 active projects have it. Projects with
  no date → a collapsed "No start date" group. Never hide older/future projects, just filter.
- **Three states only:** COVERED · ON ORDER (+ "Late" flag) · NEEDS ACTION (+ owner: Stores /
  Procurement / QC). Keep the underlying reason as a small sub-tag (Held for QC, Shortage, Remnant,
  Check units…). Map from `PLAN_STATUS` in `lib/plan-coverage.mjs`:
  in_hand/covered → Covered; on_order → On order; late → On order + Late; held_qc → Needs action/QC;
  sourcing → Needs action/Procurement; decision → Needs action/Stores; check_qty → Needs action;
  unreleased → shown at project level ("BOM not released"), never as shortage rows.
- Project health: Needs action > On order > Covered (green/yellow/red). No scores.
- **Drop Chase/Expedite** (no backend exists). Keep only real actions: Reserve, Raise PR (below),
  Ask (existing `POST /api/production/tasks`) for rows owned by another department.
- Trade Orders (source `sas`) stay in their own tab. "Build Stock" (source `stock`, sentinel project,
  no dates) → show as a "Stock (no project)" group, or leave to Reorder Suggestions in /pr (owner
  deferred this; the /pr-into-/stores merge is deferred too).
- Material Plan is not needed for Production or Procurement. Daily plan alerts to Procurement/QC
  (`lib/plan-alerts.js`) **stay for now**.
- Planning tab "Material Plan" can be removed from /planning only when the owner says so.

## Things in old Demand that are BETTER than Plan — must be carried over before retiring it
(`components/StoresWorkspace.jsx`: `OpenRequestsCard`, `ReserveDialog`, `possibleMatches`,
`MatchSettingsPopover`, `ReservationModeToggle`)
1. Fuzzy "possible match in stock" hints (`possibleMatches`): Plan only matches by exact catalog
   `item_id` or remnant geometry; 6 of 16 inventory items aren't catalog-linked.
2. `ReserveDialog`: choose which inventory item + quantity; partial reserve splits the line.
3. Auto/Manual allocation mode toggle + plate tolerance settings popover.
Old Demand rows come from `getOpenBomItems()` (has item_id, moc, size_spec, qty_text, rolled_qty,
qty_breakdown, reserved_qty, source). Plan rows (`getPlan`) have description, moc, size_spec,
qty_text, item_id is NOT in the output row today — add it (and whatever `ReserveDialog` /
`possibleMatches` read) rather than refetching.

## Raise PR instead of "Send to Procurement"
Today "Send to Procurement" = `POST /api/bom-items/[id]/procure` (clears `pending_review`, notifies
Procurement). Owner wants a real PR so it appears in PR history (`/pr` → PR History, built in §5by).
Design: new route (e.g. `POST /api/bom-items/[id]/raise-pr`) that creates a `purchase_requisitions`
header (raised_by_dept 'Stores') + `pr_items` row (+ `pr_item_projects` split) **for the net
shortage**, links the EXISTING bom_item via `bom_items.pr_item_id` (do NOT insert a duplicate
bom_item — the normal PR flow inserts new ones, `app/api/purchase-requisitions/route.js`), clears
`pending_review`, keeps the same permission (`stores.procure`) and notification. Build Stock already
raises a PR (source 'stock') via Reorder Suggestions → reuse as is.

## ERP behaviour (answer given to the owner)
ERPs (SAP MRP, ERPNext) send Procurement the **net requirement** = gross − stock available −
on order. Here: if Stores reserves 3 of 10, the existing split-on-reserve leaves a reserved clone
(3) and a remainder line (7, `qty_resolved=1`), so Procurement's Enquiry already shows 7. In **Auto**
mode that happens automatically; the gap is **Manual** mode before Stores acts. Fix (owner liked it):
small **"Stock available: N" pill** on the Procurement Enquiry row (from the same plan numbers, not
a second calc), sort those rows last, pill disappears once Stores reserves. No new category.

## Build order
1. `lib/plan-coverage.js`: add `item_id` (+ any dialog fields) to plan rows; add a server-side
   **project summary** function: candidate projects (released BOM, active, non-master-children) →
   filter by need-by window → `getPlan({projectIds})` → per-project counts of the 3 states + health.
   Correctness note: free-stock pool is handed out in need-by order; window must be
   `needBy ≤ cutoff` (no lower bound) so earlier projects are never starved by excluded ones.
2. API: `GET /api/plan/projects?within=14` (summaries) and lines per project on expand
   (`/api/plan?project_ids=`). Same department gate as `/api/plan`.
3. New Stores tab component (replace the `requests` tab body, key stays `requests`, label "Demand"):
   project cards (Required/Covered/On order/Needs action/Start date), expand → compact lines
   (Material, Required, state, Available, On order + ETA, Owner, Next action). Reuse `ReserveDialog`
   + `possibleMatches` + settings popover + mode toggle for Stores-owned rows. Search + window
   selector only (no filter wall). Pagination/collapsed groups so the page stays fast.
4. Unit guard (narrow, optional): if catalog `items.uom` and the BOM `qty_text` unit are both known
   and incompatible → status "Check units" (Needs action, Stores), excluded from pool allocation.
   Inventory items have NO uom column; only works for catalog-linked lines. No conversion.
5. Raise-PR route + wire the button. 6. Procurement Enquiry "Stock available" pill.
7. Only after parity: delete old `OpenRequestsCard` Demand usage (keep it for Trade Orders, which
   reuses the component with `source==='sas'`).

## Verify (browser, not just API)
Covered project → Covered; PO → On order; late PO → On order + Late; true shortage → Needs action;
QC-held not Covered; unreleased BOM creates no shortage rows; reservations respected; remnant
coverage works; Reserve works; Raise PR appears in PR History and Procurement Enquiry; Ask works;
permissions unchanged; project summary equals its lines; window filter + "No start date" group.

## Working notes for the next chat
- Dev server: `.claude/launch.json` has `shanti-ops-stores-verify` (port 3061, own build dir). Use
  `preview_start`. Log in via `fetch('/api/login')` as `stores_head` / `stores_head123`.
- The shared remote Turso DB is live data. Disposable test rows must be named `ZZ-…` and deleted
  afterwards (check FKs: Turso enforces them).
- `lib/db.js` / `lib/data.js` often have another session's uncommitted edits: commit only your
  hunks (build from `git show HEAD:file`, apply your patch, `git hash-object -w` +
  `git update-index --cacheinfo`), never `git add` the whole file blindly.
- `npm run lint` only checks syntax — it missed a broken quote in an API route once; always load
  the page/route in the running server.
- DB connection: commit `eb96a7d` added a short keep-alive (undici) for Turso dead sockets; retry
  on reads exists in `lib/db.js`.
- Already shipped this week: Stock Movement report, Allocator/Macro Allocator sidebar regroup
  (`7fff5b5`), partial-delivery Allocator, paginated Inward tab. Open issue found: scalar stock may
  be credited twice (vendor-bill approval AND QC inward release both add to on_hand) — unverified.

---
## Extra context (so the next chat has no gaps)

### How the Stores page gets its data today (`app/stores/page.js` → `StoresWorkspace`)
One server component loads everything: `getInventoryItems`, `getOpenBomItems` (= old Demand rows),
`getActiveReservations`, `getActiveProjectsList`, `getGateInwardReceipts`, `getTestCertificates`,
`getSourcingItems` (used by Inward tab, with `attachDeliveryLotDates`), `getSplitOrdersNeedingStoresAction`,
`getPendingInwardApprovals`, `getUnroutedReceivedItems` (Allocator). `attachCombinablePlateHints(openRequests)`
adds a manual "could these plate lines be combined?" hint to old Demand rows — **a 4th feature of old
Demand to carry over (or consciously drop)**. Sidebar keys (labels were renamed, keys kept so links
work): `receive`=Inward, `gir`=Gate Pass, `requests`=Demand, `trade`=Trade Orders, `indents`,
`allocate`=Allocator, `split-allocation`=Macro Allocator, `issued`=On Floor, `inventory` (pinned
bottom; landing tab). `?tab=reservations` redirects to Allocator.

### Old Demand vs Plan — semantic differences that matter
- `getOpenBomItems()` WHERE: status NOT IN (Received, Cancelled, In-Stock); includes `pending_review=1`
  lines (Stores Review gate, Manual allocation mode) and lines from **unreleased** BOMs. ~1,694 rows,
  mostly unreleased. New Demand must be released-only (owner decision) — so Stores loses early
  reservation for unreleased BOMs; intended.
- `pending_review=1` means "invisible to Procurement until Stores clicks Reserve or Procure"
  (Manual mode). Auto mode inserts 0 and auto-reserves what matches. This gate is why Procurement
  never sees a line Stores hasn't decided; Plan status `decision` = pending_review, `sourcing` = not.
- Reserve split: reserving part of a line leaves a reserved clone + remainder row with
  `qty_resolved=1` (`lib/procurement.js` reserveFromStock / cloneBomItemForSplit). Plan rows are
  self-contained per row so they sum correctly.
- Existing routes the UI must keep using: reserve stock `POST /api/inventory-items/[id]/reserve`
  (perm `stores.reservation.reserve`), reserve remnant `POST /api/stock-pieces/[id]/reserve`,
  procure `POST /api/bom-items/[id]/procure` (perm `stores.procure`), ask `POST /api/production/tasks`
  (with `from_department`). `PlanTab.jsx` already shows how a non-permitted viewer degrades to "Ask".
- Engine output per row (`computePlan`): id, project_id, needBy, required, ambiguous, purchase_status,
  pending_review, poolKey, secured, free, remnant(+piece id/code), incoming(+date), held_qc, short,
  status, action, urgent. `getPlan` adds description/moc/size_spec/qty_text/catalog_item_code/source/
  project_label/customer_name/group/inventory_item_id/inventory_description. Pure engine:
  `lib/plan-coverage.mjs` (selfcheck `node lib/plan-coverage-selfcheck.mjs`); data gather:
  `lib/plan-coverage.js` (**selects `b.*` for all ~2,583 active BOM lines ≈ 3 MB and runs ~15 queries
  + IN-lists of all ids — scope by project ids first**; `getPlan({projectIds})` already supports it).
- Pool rule: free stock is one pool per inventory item handed out in need-by order; scoping to a window
  must not exclude EARLIER projects (see step 1 note).
- `lib/plan-alerts.js` (daily, via cron route `app/api/sales/quotation-reminders`) uses `getPlan()`
  for all projects — keep working when `getPlan` changes.
- Inventory tab calls `/api/plan?summary=items` on every open (heavy; Planning issue, left as is).
- Plan quantity caveat: no unit comparison anywhere; lines without `item_id` can't match free stock.

### Raise-PR details
`purchase_requisitions(pr_no via counter, raised_by_dept, created_by)`, `pr_items(pr_id,
material_description, moc, size_spec, qty_text, sort_order, category, category_fields_json,
named_parts_json, origin)`, `pr_item_projects(pr_item_id, project_id, qty_text)`; `bom_items.pr_item_id`
links a line back. Raising departments allowed: Engineering, Design, Stores, Sales, Installation.
PR History reads `getPurchaseRequisitions()`; Procurement Enquiry shows "PR-n · date" via the
`pr_item_id` join. Procurement visibility for PR-raised lines skips both the pending_review and the
release_bom gates (`getSourcingItems`), so a PR raised from Demand shows in Enquiry immediately.

### Shipped this week that touches Stores (for orientation)
- `stock_movements` table + triggers on `inventory_items.on_hand` (history from 2026-09-30) and the
  report "Stock Movement & Project Consumption" (Stores → Reports). Report compares closing vs
  current on_hand and warns on mismatch.
- Allocator (`getUnroutedReceivedItems`): lines that arrived (fully OR partly, QC-cleared receipts
  only) or are reserved from stock and have no routing row; QC-pending/rejected receipts excluded.
  Reserved lines still need Issue (sets purchase_status In-Stock; Procurement milestones and packing
  readiness depend on it) — "Ready to Issue" card now sits under the Allocator. **Open gap:** a
  reserved line routed to Dispatch has no automatic Issue; one routed to Production is consumed at
  indent release but purchase_status stays Enquiry unless Issue is clicked.
- Inward tab lists open lines by default, paginated 15/20/35/50/100.
- Naming: Stores "Gate Pass" (inbound gate log) now clashes with Dispatch's outbound "Gate Passes".

### Known open issues (unverified / not fixed)
- Possible double credit of scalar `on_hand`: vendor-bill approval (`app/api/vendor-bills/[id]/route.js`)
  AND QC inward release (`lib/bom-receiving.js` releaseScalarFromInwardHold) both add stock.
- Inventory value shows 0.00 (avg_cost unset) in the stock report.
- Planning tab issues documented in `docs/inventory-planning-guide.html` are intentionally untouched.

### Update 2026-10-01 (after this plan was written)
- Fixed: reserved stock routed to Dispatch stays reserved and counts as packable (`getReservedBomItemIds`
  in `lib/data.js`, used by the three readyForPacking predicates); when the packing list is first
  marked Dispatched, `app/api/packing/[id]/route.js` issues the active reservations (on_hand drops,
  line becomes In-Stock — visible in the stock report). Verified end to end with a disposable project.
- Fixed: vendor-bill approval no longer adds quantity to `on_hand` for scalar/batch items (stock is
  credited at receipt/QC release); it only updates `avg_cost`.
- Added: "Cost per unit (₹)" on the Inventory item form (`avg_cost`), so stock value is non-zero.
- Renamed Stores tab "Gate Pass" → "Gate Entry". Help (/help Stores) has new entries for the sidebar
  and the stock report.
- Inventory tab + plan: `/api/plan?summary=items` runs the FULL plan on the SERVER each time Inventory
  opens (~3 MB read from Turso, ~15 queries); the browser only receives the small per-item summary.
  Still worth scoping when the plan is reworked.
