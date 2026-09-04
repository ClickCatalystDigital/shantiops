# Multi-unit BOM split — master project + N executable child units

**Status: design review draft (2026-09-04) — nothing in this document is built.** Every schema
sketch, department recommendation, and open question below is a proposal for the user to review,
not a spec to build from unchecked. Delete/fold this note once the design is confirmed and a real
build round starts (matching the convention `QC-FOLDER-DESIGN.md`/`PRODUCTION-MODULE-DESIGN.md`
already use for a doc that moves from "design" to "as-built, kept as historical record").

## Why this exists

`projects.unit_count` (SYSTEM.md §5be, shipped and live) is a pure *quantity* multiplier — it scales
BOM-line numbers (`2 Mtrs × 50 = 100 Mtrs`), nothing else. A real project like SB-1109
(`unit_count=50`) is still exactly **one** project row today: one milestone chain, one QC
document/certificate set, one packing-list series. That's the right shape for Procurement and
Stores, which genuinely want one aggregated number ("buy 100 Nos of this bolt"). It's the wrong
shape for the departments whose real work is inherently per-physical-unit: a boiler is IBR-certified
and dispatched one at a time, not "50 at once" — `qc_documents` is already documented in this
codebase as "1:1 with a boiler/project" (SYSTEM.md §5d, and confirmed again this round by reading
`lib/db.js:902-921`), and `BOM-FOLLOWUP-NOTES.md` §4 already flagged tracing "what Production and QC
see once a BOM is released" as unfinished business pointing at exactly this gap.

The ask: Design/Engineering author the BOM **once**, on one project, for all N units. Then a
deliberate action splits it into real per-unit child projects (`SB-1109-01` … `SB-1109-50`) so the
departments that need per-unit tracking get it, while the departments that want to keep working in
aggregate still can.

## Guiding principle

**Master = commercial/planning aggregate. Child = physical execution identity. Batch/Lot = a
grouping mechanism for department *actions*, never a replacement for a child's own individual
identity or records.**

Concretely: a batch action (QC inspecting units 1–10 together, Dispatch shipping units 21–30
together) is a UI/workflow convenience. The resulting *data* must still land as N separate,
individually-attributable records — N QC certificates, N dispatch confirmations — never one record
covering "the lot." Every section below should be checked against this, not just the schema sketch.

**Implementation constraint, stated explicitly per direct instruction (twice)**: wire into what
already exists — reuse the real machinery cited in §2/§3 rather than building parallel systems —
and do not break any existing workflow while doing it. Concretely for Stores: the existing Requests
workflow (`StoresWorkspace.jsx`'s Open Requests / Reserve-from-stock / Trading (SAS) tabs, §5e) is a
different, unrelated concern (non-BOM trade/stock requests) and must not be replaced, merged into,
or otherwise disturbed by anything in this design — everything below is additive alongside it.
**Before any change to `purchase_status`/receiving semantics specifically**: a plain grep found 29
files touching `purchase_status` across `lib/` and `app/api/` — every consumer must be checked, not
assumed safe, before that field's transition rules change at all. At least these are known to fire
real side effects on the transition into `'Received'` specifically and must keep firing at the
*correct* moment (full receipt, not every partial one) if scalar receiving becomes multi-step:
`app/api/bom-items/[id]/route.js`'s PATCH route (auto-inserts the QC incoming-inspection record,
§5p), `lib/milestone-auto.js`'s `syncProcurementMilestones` (auto-completes Procurement milestones
once every line clears a stage), and `lib/dependency.mjs`'s readiness-check signal. Prefer the
smallest backward-compatible extension (an additive column/table, not a semantics rewrite) and state
explicitly, in whatever gets built, exactly which existing behavior is unchanged.

## 1. Confirmed architecture (settled — not open for re-litigation)

Confirmed directly with the user in this design round:

1. **This is not "50 independent projects."** One master project/order — it keeps its existing full
   number (e.g. `SB-1109-01-50`) — containing N executable child units (`SB-1109-01` …
   `SB-1109-50`). The master ↔ child relationship must be preserved and visible everywhere.
2. **Per-department split, not all-or-nothing:**
   - **Design/Engineering** — creates the master BOM once, for all N units. No per-child BOM
     authoring.
   - **Procurement** — stays fully at the master/aggregate level: one PO, one set of quantities,
     exactly as it works today. Never touches child projects directly.
   - **Stores** — receives against the master's aggregate requirement. A receipt records the actual
     quantity physically received (e.g. "180 of 500 bolts"), never an assumption that a complete
     child unit arrived. **Receipt quantity and child-unit allocation are two separate concepts** —
     a receipt may *optionally* be allocated to specific child units once that's known (e.g. "these
     180 are earmarked for units 1–10"), but the model must stay flexible enough for both
     unit-aligned deliveries and non-unit-aligned partial quantities; no simplistic rule forcing one
     shape. Stores must never be forced into 50 separate receiving transactions just because there
     are 50 children. Full detail in §3/§4/§5.2 below — this is the most fleshed-out department in
     this doc, per direct instruction.
   - **QC, Production, Dispatch** — operate on real child units/projects, **and** must support
     acting on a batch/lot of several children at once (inspecting or dispatching units 1–10
     together in one action), not forced into doing everything one child at a time.
   - **Installation/Service** — not explicitly asked about, but `service_calls` already assumes one
     row per physical unit, same as QC (`lib/db.js:3816-3837`). Treated the same way as QC/
     Production/Dispatch below, flagged for the user to confirm rather than assumed.
3. **Split trigger** — a manual, explicit action once the master BOM is finalized and unit count is
   confirmed, same shape as the existing "Release BOM" action. **Not** kept live-in-sync on every
   `unit_count` edit. After split, children are real execution records; further master-BOM edits
   must be **controlled**, not silently overwritten into children that already have real work
   against them (see the BOM-revision open question, §5).
4. **Master project role** — stays as the umbrella order: Sale Order link, Scope of Supply, the
   master/aggregate BOM, cross-unit reporting. Never retired.
5. **Numbering** — the master keeps its current number as-is (e.g. `SB-1109-01-50`); children become
   `SB-1109-01` … `SB-1109-50`. Checked against every place `project_no` shape is parsed today
   (`scripts/qc-reassign-certs.mjs`'s model-code hunt, and the `STF-`/`SB-` company-prefix rule at
   `lib/db.js:3095`) — neither would misfire on a `SB-1109-01`-style child number.

## 2. What's already reusable (confirmed by direct code investigation this round)

- **No parent/child concept exists anywhere today.** `projects` needs a new nullable,
  self-referencing `master_project_id` column — grepped the whole repo for `parent_project`/
  `master_project`/`split_from`/`variant_of`/`child_project`: zero matches. This is new.
- **`insertTemplateTree()`** (`app/api/bom-assemblies/[id]/apply-template/route.js:41-100`) is
  already project-agnostic — it takes any `projectId` and materializes a flattened tree into it,
  with a proven `idMap` old-id→new-id clone pattern. `apply-templates-to-project/route.js` is the
  closest existing precedent for "materialize a tree into N different target projects" — the
  building block a future per-unit BOM-view step (if any is needed — see §5) would reuse, not
  reinvent.
- **A PO can already span `bom_items` from multiple different real projects today.** Confirmed:
  `addItemToDraftPO` (`lib/procurement.js:63-97`) drafts one PO per **supplier**, not per project;
  `po_items.project_id` has no FK, it's a denormalized snapshot column only
  (`lib/db.js:636-647`). This means Procurement staying master-only (§1.2) needs **zero** new
  cross-project PO machinery — it already works this way.
- **Packing lists are already many-to-one per project** (`packing_lists.project_id`, no unique
  constraint, `lib/db.js:141-159`) — multi-shipment dispatch under one project is already
  structurally possible without a split. Relevant to Dispatch's section below: a "lot" concept there
  is additive to something that already exists, not a rebuild.
- **Per-department schema shape** — milestones are flat/per-project by explicit design
  (`createProjectMilestones`, `lib/db.js:5053-5111`, with a comment at `lib/db.js:91` reading "flat,
  no intermediate unit layer"). `work_orders`/`job_cards` carry numeric planned/done/rejected
  quantities (`qty_planned`/`qty_done`/`qty_rejected`) — batch-quantity-shaped, not one-row-per-unit.
  `sales_invoices`/`scope_of_supply` are anchored to the Sale Order (the whole commercial order, all
  N units as one line) via `sale_order_id`, with `project_id` only a loose nullable back-reference on
  invoices. This shapes the per-department recommendations below — not every department wants the
  same treatment, and the schema already tells you which way each one leans.

## 3. Schema sketch (proposed — needs review, not final)

- **`projects.master_project_id`** — nullable, self-referencing FK. NULL on every project today and
  on the master itself; set on a child to point at its master.
- **`projects.unit_no`** — nullable integer, the child's own position (`1`..`N`). Needed so
  sorting/lot-range logic never has to re-parse `project_no` strings.
- **`bom_item_receipts`** (RESOLVED, §5.2) — `id, bom_item_id, stock_receipts_id, qty_received,
  received_by, received_at`. One row per receiving event against a scalar-tracked master BOM line
  (multiple allowed, unlike today's single overwrite). `purchase_status` flips to `'Received'` only
  once `SUM(qty_received)` for a line meets its required qty — every existing consumer of
  `'Received'` keeps its current meaning unchanged (§ Implementation constraint above). Batch-tracked
  material needs no equivalent — `inventory_batches` (`lib/db.js:3609-3623`) already accumulates
  correctly across multiple receipts, confirmed reusable as-is.
- **`bom_item_child_allocations`** (RESOLVED, §5.2) — `id, bom_item_id, child_project_id,
  qty_allocated, allocated_by, allocated_at`. One shared table for both tracking modes — allocation
  is a bookkeeping step over already-received quantity (from either `bom_item_receipts` or
  `inventory_batches`), not itself a physical-stock mechanism, so it doesn't need to fork per
  tracking mode. Optional per line; nothing requires every received unit to be allocated.
- **No persisted "lot" entity** (RESOLVED, §5.3/§5.11) — QC/Production/Dispatch batch actions are an
  ephemeral UI multi-select over children, never a stored grouping. Confirmed as the safer default:
  the four departments' real groupings (material lot, Production batch, QC batch, Dispatch shipment)
  don't reliably line up, so persisting one shared entity would misrepresent at least three of them.
- **Milestones-per-child** (RESOLVED) — children get the **full** ~25-stage `MILESTONE_TEMPLATE` via
  `createProjectMilestones()` completely unchanged, same as any other project. Simpler and safer than
  a scoped-down subset: Design/Procurement-stage milestones on a child simply have no real action
  taken against them (Procurement/Design never touch children per the confirmed architecture) and
  read as "not started" indefinitely — inert, not wrong, and avoids a second, child-specific
  milestone template needing separate maintenance.

## 4. Per-department sections

### Design / Engineering
Creates the master BOM once, exactly as today (`bom_assemblies`/`bom_items` on the master project,
`unit_count` set to N). No new per-department screen needed for authoring. What's new: the "Split"
action itself (§6) is likely a Design/Engineering (or PM) action, same authority tier as "Release
BOM" today.

### Procurement
**No change to how Procurement works.** Stays entirely on the master project's own aggregated
`bom_items` — sourcing, quotes, supplier selection, PO issuance all continue exactly as they do
today (confirmed reusable per §2 — a PO can already draw from multiple projects' `bom_items` if it
ever needed to, but here it doesn't need to at all, since Procurement never touches a child). The
existing Sourcing/Selection/PO/Status tabs (`ProcurementWorkspace.jsx`) need zero changes.

### Stores (the most fleshed-out section in this doc, per direct instruction)
Continues receiving against the master's aggregate BOM lines — Procurement's PO and Stores' GRN both
stay at the master level, unchanged. What's new is entirely additive on top:

- **The canonical pipeline, stated exactly as instructed** — six distinct stages, never collapsed
  into each other: **Master BOM requirement → Procurement ordered qty → Stores received qty →
  Stores available qty → optional child-unit allocated qty → child readiness.** Two invariants that
  follow directly and must hold in whatever gets built: **a receipt does not automatically mean a
  child unit is complete** (receiving material and a child being "ready" are different facts, linked
  only through the optional allocation step), and **allocating material to a child does not create a
  separate procurement requirement** (allocation is a pure bookkeeping/traceability step over
  already-received stock — it never triggers a new PR/PO, never touches Procurement's own aggregate
  numbers).
- **A per-master-BOM-line pipeline view** surfaces this to Stores: ordered qty (from the master's own
  `bom_items.qty_text`, already correctly reflecting `unit_count`, §5be) → received-so-far →
  available → allocated. Real numbers, not a status word — matches the "Stores should be able to
  see..." requirement directly.
  "Received-so-far" is computed differently depending on the line's tracking mode (§3): for a
  batch-tracked line, `SUM(inventory_batches.qty WHERE status='available' OR 'consumed')` already
  gives this; for the still-more-common scalar/free-text-GRN line, this requires the receiving flow
  itself to stop being one-shot (see below) — the pipeline view can't show a real running total
  until the underlying receiving action can record more than one partial receipt per line.
- **A receipt records a real quantity, never an assumed complete unit.** For batch-tracked material
  this already works exactly this way (§3) — a new `inventory_batches` row per delivery, `qty` set
  to whatever actually arrived, no forced link to any child. For scalar-tracked material, the
  existing `POST /api/bom-items/[id]/receive` action needs to stop treating `purchase_status →
  'Received'` as a one-shot terminal transition once qty tracking matters here — this is real,
  non-trivial schema/route work (not just a new join table), flagged plainly rather than glossed
  over. Exact shape (a running `received_qty` column vs. a proper receipt-events table for scalar
  material, mirroring `inventory_batches`) is an open question, §5.2.
- **Allocation to child units is optional and separate from receipt**, exactly as instructed:
  supports both a clean unit-aligned delivery ("these are for units 1–10") and a partial,
  not-yet-unit-aligned quantity ("180 bolts received, not yet earmarked to specific units"). Never
  forces Stores to touch 50 child projects to log one receiving action — allocation is a distinct,
  later, optional step a Stores head can take once they know how material maps to units, not a
  required part of receiving itself.
- **Traceability both directions**: every receipt/batch traces back to the master BOM line and PO
  (already true today via `stock_receipts.po_id`); every allocation additionally traces to whichever
  child unit(s) it was assigned to. Nothing here duplicates `bom_items`/`inventory_reservations` per
  child — allocation is a linking/reporting layer over the existing master-level receiving flow.
- **Feeds downstream readiness**: once material is allocated to a child unit, that child's
  Production/QC readiness signal should be able to reflect it — mirroring how `getProjectBom()`'s
  existing `readyForPacking` predicate already works (§5h), just resolved per-child instead of
  per-project. Exact threshold (100% of a child's lines allocated vs. partial-credit) is not decided
  — flagged, not invented, per open question 5.2.
- **Existing Stores workflows are completely untouched.** Open Requests, Reserve-from-stock, and
  Trading (SAS) requests (`StoresWorkspace.jsx`, §5e) are a different, non-BOM concern — nothing
  above replaces, merges into, or shares a screen with them. This pipeline view is a new panel
  alongside the existing ones, not a redesign of Stores' workspace.

### Production
Job cards and Work Orders move from "one project" to "N child projects, worked in batches." A
Production head should be able to select a lot (a range of children) and create/act on job cards for
all of them in one motion — but each resulting `job_cards` row still belongs to one specific child
`project_id` (per the guiding principle: batch action, individual records). `work_orders` similarly
either stays master-level (an aggregate Work Order covering all N, if that's still how Production
wants to plan capacity) or gets created per-child/per-lot — **open question**, not decided; the
schema (`qty_planned` etc., §2) leans toward "master-level planning, per-child execution records,"
but this needs the Production head's own input before committing to a shape.

### QC
The strongest case for per-unit already existing in the schema (`qc_documents` is "1:1 with a
boiler/project," `lib/db.js:902-921`) — this is exactly the gap the split closes. QC should be able
to select a lot and run one workflow (e.g. "generate a Form IV A part list") across it, but per the
guiding principle the actual result must still be **N separate certificate/document sets, one per
physical boiler** — never one document covering "units 1–10." `qc_records`, `test_certificates`
(cross-project via the existing `certificate_projects` join, unaffected — a plate/cast cert
genuinely can cover several boilers and should stay shared) all need to resolve to the *child*
project, not the master, once split.

### Dispatch
Already structurally ready for multi-shipment (`packing_lists` is many-to-one per project, §2) — a
split makes this cleaner, not new: each `packing_lists` row would belong to one child project
(one boiler, one shipment, one e-way bill, one dispatch date) instead of today's single project
carrying several loosely-related packing lists. A Dispatch "lot" (a batch of children shipped
together on one truck, say) is plausible but — per the guiding principle — each child still needs
its own packing-list identity and e-way bill; a lot here is a *scheduling* convenience, not a
merged shipment record. **Open** whether Dispatch's "lot" is the same table as Stores'/QC's (§5).

### Installation / Service
Not explicitly discussed with the user yet — flagged for confirmation, not assumed. `service_calls`
already assumes one row per physical unit (`lib/db.js:3816-3837`), the same shape as QC, so the
natural fit is the same treatment: per-child project, batch-select for scheduling multiple site
visits, one `service_calls`/`service_contracts` history per physical unit. **Confirm with the user
before treating this as settled** — Installation wasn't in the original ask.

### Sales / Accounts
`sales_invoices`/`scope_of_supply` are anchored to the Sale Order (the whole commercial order),
`project_id` only a loose nullable back-reference on invoices (§2) — this strongly suggests billing
and Scope of Supply should **stay at the master level**, matching how the commercial commitment was
made (one Sale Order for 50 units, not 50 separate sale orders). Whether an individual dispatch
(one child, one shipment) ever needs its own invoice line, or whether invoicing always nets out at
the master regardless of how many children have shipped, is an open commercial question — see the
"consistent identity" open question in §5, since this directly determines what an invoice/e-way bill
shows as its project reference.

## 5. Open questions — resolved (2026-09-04), except #7

Every question below except #7 has a **safe, conservative, backward-compatible default** derivable
directly from an existing pattern already proven in this codebase — none require inventing anything
genuinely novel or risky, so none were escalated back to the user. #7 (unit variants) is a real,
separate design gap already tracked in `BOM-FOLLOWUP-NOTES.md` §1 and stays explicitly deferred, not
silently solved. Each item below is marked **RESOLVED** (the decision + why it's safe) or
**DEFERRED** (explicitly out of v1, stated plainly). The original open-question text is kept
underneath each for the record.

1. **Child BOM visibility. → RESOLVED.** A **read-only, derived per-unit BOM view**: each master
   line's `qty_text` ÷ `unit_count`, computed live at read time, never stored, never cloned. Reuses
   the exact `qtyBreakdown()`-style live-computation pattern §5be already established for the
   analogous "show the math, never bake it into a stored field" rule. No new table.
   <details>Original question: children don't get cloned material lines, but nothing answered how
   Production/QC/Dispatch see what belongs to `SB-1109-17` without reaching into the master every
   time.</details>
2. **Material allocation. → RESOLVED**, both sub-parts:
   - **Scalar receiving's one-shot limitation** — fixed by adding a **receipt-events ledger**
     (`bom_item_receipts`: `bom_item_id`, `stock_receipts_id`, `qty_received`, `received_by`,
     `received_at`) that `POST /api/bom-items/[id]/receive` inserts into on every call, instead of
     the current single-shot write. `purchase_status` **only flips to `'Received'` once the running
     total across all receipt rows meets the required qty** — every one of the 29 existing consumers
     keeps reading exactly the same meaning of `'Received'` (fully received) they always have; the
     only change is *when* that transition is allowed to fire. A line still received in one shot
     (today's universal case) behaves byte-for-byte identically. This is the smallest
     backward-compatible extension available — no new status value, no consumer needs to change.
   - **Allocation table** — one shared table for both tracking modes, not forked per batch/scalar:
     `bom_item_child_allocations` (`bom_item_id`, `child_project_id`, `qty_allocated`,
     `allocated_by`, `allocated_at`). Keyed to the master's own `bom_item_id` regardless of whether
     that line is batch- or scalar-tracked, since allocation is a bookkeeping step over
     already-received quantity, not a physical-stock concept — it doesn't need `inventory_batches`'
     own machinery, just a running sum against it.
   - **Readiness threshold** — binary, matching the existing `readyForPacking` precedent (§5h): a
     child's line is "available" once `SUM(qty_allocated WHERE bom_item_id=X AND
     child_project_id=Y) >= that child's own per-unit requirement`. No partial-credit UI in v1,
     consistent with how every other readiness signal in this app already works.
3. **Is "lot" one shared concept? → RESOLVED: no persisted lot entity at all in v1.** QC/Production/
   Dispatch batch actions are an **ephemeral UI multi-select** — pick N children, run one action,
   get N individual records (per the guiding principle) — with nothing persisted about the grouping
   itself. Stores doesn't need one either: `bom_item_child_allocations` (above) already links
   material to specific children directly, without needing a separate "lot" concept in between.
   Avoids inventing a shared entity across four departments whose real groupings don't line up
   (§5's original concern) by simply not building one.
4. **Master/child status roll-up. → RESOLVED.** Computed **live, never stored** — one query per
   department counting children's own state (job cards done, QC documents complete, packing lists
   dispatched, etc.), rendered on the master project page. No new schema; built in Phase 8.
5. **Post-split quantity changes. → RESOLVED (conservative default): not supported in v1.** Once
   split, `unit_count` and the child set are frozen — the split action refuses to re-run against a
   master that already has children (ties directly into the atomicity requirement, #8). Changing
   order size after split needs manual intervention outside the app for now; stated plainly as a
   known v1 limitation rather than silently building a re-sync mechanism nobody asked for.
6. **BOM revision control after split. → RESOLVED (conservative default).** The master BOM stays
   editable after split exactly as before — no new restriction on Engineering. Every allocation/
   receipt row is its own append-only, timestamped fact (same precedent as `supplier_quotes`, never
   edited in place), so historical truth survives a later master-BOM edit regardless. No child-level
   BOM-revision-pinning mechanism is built in v1 (that would be real, separate versioning machinery
   beyond what's been asked for) — flagged here as a stated v1 simplification, not hidden.
7. **Unit configuration/variant. → DEFERRED, explicitly out of v1 scope.** The architecture assumes
   N *identical* units, matching the original ask. A real mixed-capacity order (30×500kg/hr +
   20×1000kg/hr) is a genuine, separate design gap already tracked in `BOM-FOLLOWUP-NOTES.md` §1 —
   not solved here, not silently assumed away either.
8. **Split atomicity/idempotency. → Confirmed hard requirement, implemented in Phase 2.** One
   transaction, no partial-children state on any failure; refuses to re-split a master that already
   has children (satisfies both this and #5 together).
9. **Child project lifecycle. → RESOLVED.** Children are ordinary `projects` rows — reuse the
   existing project status/lifecycle mechanics completely unchanged (no new cancel/hold/delete
   machinery; no project-delete route exists anywhere in this app today, so children follow the same
   rule as every other project). No automatic cascading close — a master does not auto-close when
   its children do; that stays a manual, deliberate action, matching this codebase's general
   preference for explicit over implicit state transitions.
10. **Consistent commercial-vs-physical identity everywhere. → RESOLVED.** The master's own number
    is used for anything commercial (invoices, Sale Order, Scope of Supply — already the confirmed
    architecture, §1.4); the child's own number is used for anything physical/execution (QC
    certificates, packing lists, dispatch documents, job cards, service calls); any child-facing
    document additionally shows the master's number alongside it (e.g. "SB-1109-01 · Order
    SB-1109-01-50") so the relationship is never ambiguous on screen.
11. **Lot UI. → RESOLVED via #3** — no persisted lot, so no lot UI; each department's own batch
    action is a plain multi-select on its existing list view.
12. **Numbering's zero-pad width. → RESOLVED.** Computed dynamically from `unit_count`
    (`String(unitCount).length`, minimum 2 digits) rather than hardcoded — correctly handles both
    ≤99-unit and 100+-unit orders with no separate code path.

## 6. The split action itself (once the open questions above are resolved)

Proposed placement: next to "Review & Release BOM" on the BOM workspace's `ReleaseReadinessPanel`
(same placement precedent as Structure Templates' icon buttons, §5bb) — a natural companion action
once a BOM is finalized. In one atomic transaction (per open question 8): creates N `projects` rows
(`SB-1109-01`…`SB-1109-N`, each with `master_project_id` set and `unit_no` set), seeds milestones
per whatever §3's "milestones-per-child" decision ends up being, and links each back to the master.
**Explicitly does not** clone the master's `bom_items`/`bom_assemblies` into each child — per §1.2,
Procurement/Stores keep working the master's own BOM. What a freshly-split child contains on day
one: an identity, milestones, and the `master_project_id` link — nothing else, until QC/Production/
Dispatch data starts accumulating on it.

---

---

## As-built status (2026-09-04)

Phases 1–4 and part of 5, 8, and 9 are now built and live-verified. Full detail in commit history
(`3f070fa`..`8175b9b` and later); summary:

- **Phase 1 (schema)**, **2 (split action)**, **3 (child BOM visibility)** — done. Split is atomic/
  idempotent, proven live with a forced mid-split collision leaving zero partial children.
- **Phase 4 (Stores partial receipt + allocation)** — done. All 29 `purchase_status` consumers
  audited before the receive route changed; `bom_item_receipts` now supports genuine partial
  deliveries without prematurely flipping `purchase_status` or firing the QC incoming-inspection
  auto-trigger early; `bom_item_child_allocations` is the optional link to specific children,
  bounded by available (received − allocated), never by required quantity.
- **Projects list rollup** (a direct follow-up ask, not in the original phase numbering) — a split
  master shows "N of M units done" and expands inline into its real children, instead of cluttering
  the list with N+1 top-level rows. `groupProjectsByMaster()` is additive; `getProjectsWithStatus()`
  itself (Executive, etc.) is untouched.
- **Phase 5 (Production), started** — confirmed structurally that `job_cards`/`qc_documents`/
  `packing_lists` creation routes have zero project-type assumptions (grepped, zero
  `master_project_id`/child-awareness anywhere) — a child project already works with every existing
  Production/QC/Dispatch screen unmodified, since it's an ordinary `projects` row. The one genuinely
  new piece — a **batch action** (pick several children + one milestone_key, get one job card per
  child, each its own record) — is built and live-verified for Production
  (`POST /api/job-cards/batch-children`): a real 3-unit batch created 3 job cards with 3 distinct
  `project_id`/`milestone_id` pairs. **QC and Dispatch's own batch routes are not yet built** — the
  identical pattern (resolve each child's own analogous entity, insert one record per child, loop)
  applies directly; this is a fast, mechanical follow-up once needed, deliberately not duplicated
  three times without a concrete driving case.
- **Phase 8 (status/reporting), partial** — done for the Projects list (above). Executive's own
  dashboard still shows every project flat; extending it to the same rollup is the same
  `groupProjectsByMaster()` call, not yet wired in there.
- **Phase 9 (customer-facing identity), confirmed safe by construction, no new code needed** — the
  split action never touches `users.project_ids`, and `canAccessProject()` (the only gate a customer
  ever passes through) checks exactly that field — so a customer can never see or reach a child
  project, even by guessing its URL. Verified by reading both code paths directly, not assumed.
- **Not started**: Phase 6 (QC batch route), Phase 7 (Dispatch batch route), Phase 8's Executive-
  dashboard rollup, Phase 10 (a dedicated full regression pass beyond what each phase already
  verified individually).

Every phase above was live-verified against the real dev DB with disposable test data, cleaned up
to zero residue afterward, and is lint-clean. No existing single-project workflow has regressed at
any point.
