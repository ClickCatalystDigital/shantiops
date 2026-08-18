# Shanti Ops — Gaps & Next Steps (audited 2026-08-17)

Handoff doc for picking up where this session left off, without re-running the audit. Every item
below was independently verified against the live code (file:line), not just read off a doc.

## What this session shipped (full detail in SYSTEM.md §5h — read that before touching any of this)

- Stores sidebar workspace (Inventory / Open Requests / Active Reservations / Material Issued).
- Projects list + project-detail page: department pill + active-milestone label + progress, shared
  via `lib/data.js`'s `activeDepartmentStatus()` and `components/DepartmentStatus.jsx`.
- Cross-department BOM visibility gates: Procurement only sees a line once Design's `release_bom`
  milestone is done; Production/Stores only see items with `purchase_status IN ('Received',
  'In-Stock')`; Dispatch can only pack items Production has flagged `production_done`.
- Milestone automation (`lib/milestone-auto.js`) — most milestones now complete themselves off a
  real event instead of the manual status drawer: Production's 12 milestones (job cards), Hydro
  Test (QC record pass), Packing (packing_lists.status), Procurement's 5 stage milestones
  (renamed Enquiry/Comparison/Ordered/Transit/Procured, driven by `bom_items.purchase_status`),
  Design Approval (aggregated customer drawing approvals). Design and Site
  Installation/Commissioning got explicit "mark complete" buttons instead (no reliable signal to
  auto-detect from).
- Requests (`/pr`) rebuilt with a sidebar: Raise PR (unchanged), Release BOM (new explicit action),
  Templates (new — reusable per-boiler-model BOM templates, `bom_templates`/`bom_template_items`).
- Scope of Supply completed to match the real Order Acknowledgement paper document: header
  (`scope_of_supply` — client/PO/GST/payment-freight-delivery terms) + priced line items
  (`scope_of_supply_items`) + computed totals + PDF export (`lib/sos-pdf.js`).
- Milestone Tracker help table added to Design/Procurement/Production/Dispatch/Installation's
  `/help` guides (`components/department-help-content.jsx`), documenting the automation above in
  plain language.

Nothing above needs re-investigating — trust it as built and verified live in-browser.

## Confirmed gaps, ready to act on (small, same pattern as code already in the repo)

1. ~~**QC never receives a cross-department notification, ever.**~~ **SHIPPED 2026-08-17.**
   Scope decided with the user: QC gets notified once every BOM item on a project clears
   Procurement (`procurement_procured` milestone completing), so QC can start prepping
   inspection records. Implemented as `notifyMilestoneExtra()` in `lib/milestone-auto.js`, called
   from `markMilestoneDone`. Verified live: advanced all 4 BOM items on SB-1023 to Received via
   the real Procurement UI → `procurement_procured` auto-completed → `qc_head` (user_id 13)
   received the notification (dedupe_key `procurement_procured:16`).

2. ~~**Project completion notifies nobody.**~~ **SHIPPED 2026-08-17.**
   `notifyMilestoneExtra()` (same function as #1, `lib/milestone-auto.js`) special-cases
   `milestone_key === 'commissioning'`: fires `notifyDepartment('Sales', ...)` +
   `notifyPMs(...)`. Turned out commissioning has *no* auto-detect signal (per the "already
   known" note below) and only ever completes via the manual PATCH route
   (`app/api/milestones/[id]/route.js`'s `InstallationMilestoneActions` "Mark complete" button),
   never through `markMilestoneDone` — so `notifyMilestoneExtra` had to be exported and called
   from *both* places to actually fire. Verified live: clicked "Mark complete" on SB-1023's
   Commissioning milestone in the UI → 5 Sales/PM users notified (dedupe_key `commissioning:16`).

3. ~~**Engineering gets exactly one notification type**~~ **SHIPPED 2026-08-17.**
   Scope decided with the user: notify Engineering when a BOM template is applied to a project
   (`app/api/bom-templates/[id]/apply/route.js`), alongside the existing Stores notify — same
   ownership precedent as item 1 (Engineering owns the BOM definition). Uses `except: user.id` so
   Engineering doesn't get pinged for applying its own template. Verified live: created a template,
   applied it to SB-1023 via the real Templates UI → 4 Engineering-department users notified
   (dedupe_key `bom_template_apply_eng:<template>:<project>`). Test template/item/notifications
   deleted after verification.

4. ~~**`opportunities.stage` never auto-advances to "Quoted."**~~ **SHIPPED 2026-08-17.**
   In `app/api/quotations/route.js` POST, after insert: if `opportunity_id` is set and the linked
   opportunity's `sales_stages.sort_order` is behind `'Quoted'`'s, advance it — forward-only via
   sort_order comparison (not stage name, since `sales_stages` is DB-configurable), same rank idiom
   as `advancePurchaseStatus`. Note: no UI currently creates a quotation with `opportunity_id` set
   (`/sales`'s "New Quotation" dialog and `/pipeline`'s opportunity detail sheet both lack that
   field) — the column is only ever populated by direct API calls today, so this fix is correct but
   currently unreachable from the UI until a "Create Quotation" action is added to the Pipeline
   opportunity view. Verified live via a direct authenticated POST to `/api/quotations` with
   `opportunity_id` set: opportunity moved Lead → Quoted. Test quotation and stage change reverted
   after verification.

5. ~~**`packing_lists.status` has no enum validation.**~~ **SHIPPED 2026-08-17.**
   Added `PACKING_STATUSES = ['draft', 'packed', 'dispatched']` (matches
   `components/PackingDetail.jsx`'s own `STATUSES` list) and validate before the UPDATE in
   `app/api/packing/[id]/route.js`, same shape as bom-items/qc-records. Verified live: PATCH with
   `status: 'bogus'` now 400s (`Unknown status: bogus`); a real field update still 200s.
   (The `dc_no` test PATCH sent to packing list id 1 during verification turned out to be a no-op —
   only one packing list exists in the dev DB, id 6, and its `dc_no` was never touched. No cleanup
   was actually needed there.)

## Investigated, NOT ready to automate (real schema gaps — bigger than a quick wire-up)

- **`sale_orders.status` → `'fulfilled'`**: no real FK path from a completed project back to a
  sale order today — `bom_items.sale_order_no` is free text, not a join key. Would need actual
  schema design (a real `sale_order_id` reference somewhere in the fulfillment chain), not just
  wiring an existing signal.
- **`quotations.status` → `'accepted'`**: same root cause — no quotation→sale_order FK exists.
- **`quotations.status` → `'expired'`** off the real `valid_until` date: needs a sweep/read-time
  check (like the existing `sweepDrawingNotifications` pattern), not an event trigger — different
  mechanism than the rest of this list, lower priority.

## Already known, correctly documented, still open (SYSTEM.md §8 / §17 — no new discoveries)

- **Stores' real Auto reservation mode** — still a UI-only stub
  (`components/StoresWorkspace.jsx`). Not technically blocked anymore (the `item_id` catalog link
  from §3.2 is a real non-fuzzy match signal) — it's a deliberate judgment call nobody's made yet
  about auto-committing physical stock without human review.
- **ERPNext integration** (`erp_snapshot` table, `source='demo'|'erpnext'`) — 100% synthetic,
  gated on provisioning a real ERPNext instance (V3_CHANGES.md Track B), not a code gap.
- **Operations platform** (§8): activity-feed UI, critical-path/dependency graph
  (`milestones.depends_on_key` is schema-only, nothing reads it), general file/photo upload store,
  barcode/QR at dispatch, WhatsApp/email auto-send (currently `wa.me`/`mailto:` deep links only,
  deliberately no auto-send), a combined PM-oversight dashboard.
- **Approval/security platform** (§17): native messaging control, code signing, print/clipboard/
  screen-capture control, phone/desktop app control, Zoho external-mail approval (explicit
  `ComingSoon` stub in `components/ApprovalsWorkspace.jsx`), device blocklist granularity
  (whitelist + default-block only today, no per-device `blocked` flag mirroring the Browser
  policy's three-state model).

## Recommended order if picking this up

Items 1–5 above are all shipped and verified live (2026-08-17). All test/demo data created during
verification (test quotation + line item, test opportunity stage change, test BOM template + item)
has been deleted from the shared Turso dev DB — nothing left to clean up.

Item 4's UI gap is also closed (2026-08-17): `NewQuotationDialog` in `components/SalesWorkspace.jsx`
is now exported and takes optional `opportunityId`/`initialCustomerId` props (passes
`opportunity_id` through to the POST body). `components/PipelineWorkspace.jsx`'s
`OpportunityDetailSheet` has a real "Create Quotation" button that opens it pre-linked to the
opportunity — that's the one and only place `opportunity_id` gets set from a UI action now.
Verified live: created a quotation from the Virchow Biotech opportunity (Lead stage) via the real
Pipeline UI → opportunity auto-advanced to Quoted. Test quotation and stage change reverted after
verification. Help docs also updated across Engineering, QC, Sales, Installation, and Sales'
Pipeline feature to document all of this session's notification/auto-advance changes
(`components/department-help-content.jsx`), verified live in `/help`.

What's left, in order:

1. Everything under "already known, still open" is a standalone initiative, not a quick fix — get
   explicit sign-off on which one (if any) before starting, don't build unprompted.
2. Consider whether SB-1023 (Konkan Sugars) is still fit to use as a demo/walkthrough project —
   its BOM items, procurement milestones, Site Installation, and Commissioning were all advanced
   to real completion during this pass's live verification (not synthetic inserts, genuine writes
   through the real UI/API), which is now well ahead of its Nov 2026 planned dates.
