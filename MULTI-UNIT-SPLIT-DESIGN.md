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
   - **Stores** — receives against the master's aggregate requirement, but a physical receipt can be
     recorded as a **partial lot** (e.g. "units 1–10," "units 11–20") and linked to the specific
     child units it covers — not one all-or-nothing receipt, not 50 individual ones either.
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
- **A "lot" concept** — the one genuinely new entity, with no existing precedent to lean on.
  Proposed shape: `project_lots` (`id`, `master_project_id`, `label` e.g. "Units 1–10",
  `created_at`, `created_by`) + `project_lot_members` (`lot_id`, `child_project_id`). One
  receipt/inspection/dispatch action tags a lot instead of one child, and downstream reporting can
  always resolve "which children did this event cover." **This is explicitly not settled** — see
  the "is lot one shared concept" open question in §5 before treating this table shape as final.
- **Milestones-per-child** — open whether a child gets the full ~25-stage `MILESTONE_TEMPLATE`
  (reusing `createProjectMilestones()` completely unchanged) or a scoped-down subset that skips
  Design/Procurement stages that only make sense once, at the master. This is a data question, not a
  mechanism question — `createProjectMilestones()` already just takes a `project_id`.

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

### Stores
Continues receiving against the master's aggregate BOM lines, same as today. New: a receipt can
optionally be tagged with a **lot** (§3) — a subset of child units it covers — so a partial delivery
("180 of 500 bolts arrived") can still be linked to *which* children it's earmarked for, once that's
known. **Open**: whether that linkage is ever quantity-based (partially covering many children) or
only ever whole-unit — see the material-allocation open question in §5. Nothing here requires
duplicating `bom_items`/`inventory_reservations` per child; the lot is a linking/reporting layer on
top of the existing master-level receiving flow, not a new receiving flow.

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

## 5. Open questions — do not resolve these unprompted

A second-opinion review of the first draft of this plan found real gaps beyond what the confirmed
decisions in §1 covered. All of the following are genuinely open — none should be treated as decided
just because they're written down here:

1. **Child BOM visibility.** Children don't get cloned material lines (§1.2 — Procurement/Stores
   stay master-level), but nothing today answers how Production/QC/Dispatch see what belongs to
   `SB-1109-17` specifically without reaching into the master every time. Likely answer: a
   **read-only, derived per-unit BOM view** (each master line's quantity ÷ unit_count, computed live,
   never stored) — but this needs the user's confirmation, not silent assumption.
2. **Material allocation vs. clean unit ranges.** A real Stores receipt rarely divides evenly across
   units (500 bolts needed, 180 arrive — that's not "units 1–18 done," it's a partial quantity
   against an aggregate need). The design must distinguish **receipt quantity** from **allocation to
   specific child units**, and confirm whether allocation is ever quantity-based (partially covering
   many children) or only ever whole-unit/whole-lot.
3. **Is "lot" one shared concept, or different per department?** §3's schema sketch assumes one
   `project_lots` entity serves Stores/QC/Production/Dispatch identically. A material-receipt lot
   (units 1–10 have their bolts), a Production batch (units 1–6 worked today), a QC batch (units
   1–5 inspected), and a Dispatch shipment (units 1–3 shipped) are four different real-world
   groupings that won't necessarily line up. Don't build one shared table until this is confirmed —
   it may need to be per-department, or a lighter-weight ad-hoc selection rather than a persisted
   entity at all.
4. **Master/child status roll-up.** The master needs a real way to show "Production 15/50, QC 8/50,
   Dispatch 3/50" per department, not one aggregate status field. Not designed yet.
5. **Post-split quantity changes.** What happens when the order changes after N children already
   exist — goes to 55 (add 5 more), drops to 48 (cancel 2 — which ones, and what if they already
   have real work against them)? Explicit rules needed for increase/decrease/cancel-a-child/
   add-a-child/duplicate-prevention, even if v1's honest answer is "not supported yet."
6. **BOM revision control after split — a real versioning problem, not just "controlled edits."**
   If Engineering changes a spec after N children are split and Production has already started on
   some of them: does the change apply to all remaining children, only future ones? Does each child
   record which BOM revision it's executing (reusing `bom_release_revision`/`released_at_revision`,
   §5k — already built for exactly this kind of question, at the master level)? What happens to
   material already purchased against the old revision?
7. **Unit configuration/variant.** The architecture above assumes N *identical* units. A real order
   can be mixed (30×500kg/hr + 20×1000kg/hr under one commercial order) — directly ties to
   `BOM-FOLLOWUP-NOTES.md` §1 (capacity/configuration data on BOM nodes, already flagged,
   unresolved). Building the split without addressing this hits the same wall immediately for any
   non-uniform order.
8. **Split atomicity/idempotency — a hard implementation invariant, not a question.** The split must
   be one atomic transaction (no partial-children state on failure), must be safely re-clickable/
   retryable, and must refuse to re-split a master that already has children. Write this down now so
   it isn't forgotten when this gets built.
9. **Child project lifecycle.** Can one child be cancelled, put on hold, or completed independently
   of its siblings? Does every child closing auto-close the master, or is that a separate action?
   Can a child ever be deleted? N physical units will diverge in timing in practice — needs at least
   a stated v1 answer, even if it's "handle it like any other project for now, revisit."
10. **Consistent commercial-vs-physical identity everywhere.** Not just the Customer Portal (one
    order card vs. N). Every customer/document-facing surface — invoices, packing lists, QC
    certificates, dispatch documents, search, reports — needs one explicit, stated rule for whether
    it shows the master's number, the child's number, or both. Otherwise the same order reads as a
    different identity depending on which screen someone's looking at.
11. **Lot UI** — not designed at all yet, contingent on question 3 above.
12. **Numbering's zero-pad width** — `01`..`50` assumes 2 digits (≤99 units). Confirm whether
    3-digit orders (100+ units) are realistic enough to plan for now.

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

**Not in scope for this document**: no schema migration, no new API routes, no UI were built as part
of writing this. This is a review-before-building document. The actual implementation is separate,
later work — likely itself split into several dated build rounds (the same way Work Orders §5g,
Multi-Level BOM §5o, and the NCR workflow §5ao each shipped in phases) — once this design is
reviewed and the open questions in §5 are answered.
