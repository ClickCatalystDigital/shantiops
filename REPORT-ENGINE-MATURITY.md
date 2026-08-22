# Report Engine — Maturity & Polish Notes

Companion to `REPORT-ENGINE-PLAN.md`. That doc tracks *what's built*; this one tracks *what would
make it feel finished* — both structurally (does the system cover what a mature ERP's reporting
layer needs) and visually (do the documents themselves read as professional, filed-grade output).
Nothing here is scheduled — these are judgment calls for the user to prioritize, not a queue.

## 1. What "truly mature" actually requires (structural gaps)

The plan's own §1 framing — mature means *authoritative documents from real data*, not more
screens — is now real for Accounts/Stores/Procurement/Sales (21 documents, screen/PDF verified to
agree). What's still missing before the *reporting layer itself* reads as mature, roughly in order
of how much it would actually change how someone uses this:

1. **Excel.** Deferred by explicit choice, but it's the single biggest remaining gap for an
   Accounts user who wants to pivot/filter/reconcile a report rather than just read it. `xlsx`
   (free build, already installed) gets structure — column widths, number formats, merges — but no
   cell styling (no bold header row, no borders, no fill). `exceljs` is the real fix if/when this
   gets picked up; `lib/reports/render.js`'s `toTable()` split means adding it is "a second
   consumer of data already shaped for the table," not a rewrite.
2. **A real Monthly Management Report — DONE (2026-08-22).** One page a director opens: Liquidity
   (Cash & Bank, AR/AP outstanding, net position), P&L headline (MTD + FY-to-date), Balance Sheet
   headline (Assets/Liabilities/Equity). Per-company (matches every other report's pattern — two
   legal entities exist, see `lib/company-profiles.js`), not combined. Built entirely from
   `compute()` functions the existing catalog reports already call
   (`computeBalanceSheet`/`computeProfitLoss`/`computeArAging`/`computeApAging`) — no new ledger
   math, per the plan's "second consumer of data already shaped" principle.
   - **Data/PDF:** `lib/reports/management-report.js` (compute), `lib/reports/management-report-
     pdf.js` (render). Two API routes: `app/api/executive/management-report` (JSON, for the screen
     card) and `.../management-report/pdf` (export) — gated by `requirePM`, not
     `requireDepartment('Accounts')`, since this is an executive-altitude document, not a
     department report.
   - **Nav/placement:** its own top-level tab (`/executive/reports`, "Management Report") visible to
     `isPMUser` (admin/manager/executive), *not* folded into the `/reports?dept=` catalog. Reason:
     `components/Nav.jsx`'s `isDeptPM` check deliberately excludes the `executive` role from
     per-department Reports tabs (so they aren't handed 19 operational Accounts reports) — this one
     document needed to reach that same audience without undoing that gate or forcing an
     `Executive` entry into `lib/milestones.js`'s `DEPARTMENTS` list, which is real operational
     department data (HR employee records, project milestones) that a fake department would pollute.
   - **Two real bugs caught only by rendering real data, not by the self-check:**
     1. The `₹` (U+20B9) glyph silently rendered as a stray superscript digit — react-pdf's default
        Helvetica is a base-14 PDF font (WinAnsi encoding) with no glyph for it, no error thrown.
        Fixed app-wide (not just here) by switching `fmt()`'s currency prefix to ASCII `Rs. ` — see
        §2 below.
     2. `<ReportTotals>` (the shared closing-totals-line primitive) silently collapsed its
        label/value spacing under overflow once a line carried 4 long pairs — fine for every
        existing caller's 2-3 short pairs, first surfaced here. Rather than force this doc's 4
        stat-tile sections through a primitive built for a different shape, built a small
        fixed-width `StatGrid` local to `management-report-pdf.js` (wraps instead of overflowing) —
        and separately hardened `ReportTotals` itself with a trailing space so any future long
        totals line degrades gracefully instead of visibly merging text.
3. **Report access isn't audited.** Every write path in this app calls `audit()` (see `lib/usb.js`
   usage throughout `app/api/*`); no report PDF/JSON export does. For financial documents
   specifically ("who pulled the Trial Balance for FY26-27 and when") this is the kind of thing an
   external auditor actually asks. Cheap to add — one `audit('report_exported', {actor, key,
   params})` call in `app/api/reports/[key]/export/route.js`, generic across every report by
   construction.
4. **Production reporting — DONE (2026-08-22).** Was: two per-record costing PDFs and one Material
   Consumption Report, the whole department's coverage. Now: 6 more catalog reports — Work Order
   Register, Production Cost Variance, Rework/Rejection Report, Material Utilization Report,
   Labour Utilization Report, Material Shortage/Demand — all built off data Work Orders/Job
   Cards/Cutting already capture (`lib/data.js`'s `getWorkOrderRegisterLines`/
   `getProductionCostVarianceLines`/`getReworkRejectionData`/`getMaterialUtilizationLines`/
   `getLabourUtilizationLines`, plus a thin wrap of the existing `getProductionForecast()`), no
   schema change. Production's Reports sidebar goes from 1 entry to 7.
   - **Two real bugs caught only by rendering real data:** `getMaterialUtilizationLines`'s first
     draft selected `inventory_items.item_name`, a column that doesn't exist (`description` is the
     real one) — a 500, caught immediately. Second, subtler: a "used" offcut piece is itself born
     `status='consumed'` with `cut_at` already set (same INSERT that spends it) — the first query
     shape matched every used piece as its *own* phantom zero-output cut event, not just real
     sources. Fixed by requiring `EXISTS (SELECT 1 FROM stock_pieces c WHERE c.parent_id = sp.id)`
     — only rows something else actually points at as a parent are real cut events. Verified against
     the exact §5k demo scenario (157kg source → 127.17 used + 15.7 remnant + 14.13 scrap, 91%
     yield) and got bit-for-bit the same numbers.
   - **Job Card / Process Route Card** (a printable shop-floor traveler) is still real, unbuilt —
     deliberately not a catalog report (it's per-record, like BOM/PO PDFs, not a management roll-up).
   - **Two new gaps surfaced while scoping this** (Rework/Rejection could arguably live under a
     future QC tab instead of Production — kept in Production, simpler, no new tab) — both now
     addressed, see below.
5. **Supplier Performance stays genuinely blocked**, not from missing effort — REPORT-ENGINE-
   PLAN.md §9 flagged it correctly: "on-time delivery %" needs PO promised date vs. GRN/bill date,
   and neither field is consistently populated today. Building this now would mean either a metric
   that's silently wrong half the time, or guessing at a definition that's the user's call, not
   mine. Building it well starts with deciding what "on time" means here, not with a query.
6. **Data completeness feeds report credibility.** A report is only as trustworthy as its inputs —
   `ACCOUNTING-READINESS.md` already tracks GSTIN/PAN sparsity on suppliers; every report that
   shows a blank GSTIN (Vendor Bill PDF's `GSTIN: —`, seen live while verifying) is a small dent in
   "looks authoritative." Not a Report Engine fix — a masters-data-quality one, same root cause the
   readiness doc already names.
7. **The `/crm-reports` vs. catalog "Reports" tab duplication** (documented in REPORT-ENGINE-
   PLAN.md §0) is the one piece of nav-level un-maturity — two tabs with the same label doing
   different things reads as unfinished to anyone who notices, even though both work correctly.
8. **Design's Reports gap — DONE (2026-08-22).** Was: zero catalog reports, no Reports tab. Now:
   **Drawing Register** (`calc_drawings` across projects — status/assignee/due date, overdue flag)
   and **ECN Register** (`bom_change_notes` — field/old-new/reason/status/who requested-approved),
   both gated `department: 'Design'`. Both off existing tables, no schema change.
   - **A third instance of the `₹`-glyph bug**, caught the same way (reading the actual rendered
     PDF): ECN Register's "Old → New" column used a `→` arrow (U+2192), which react-pdf's base-14
     Helvetica also has no glyph for — rendered as a stray apostrophe. Fixed by switching to plain
     `->`. Worth noting as a pattern now, not just an isolated fix: **any non-ASCII character in PDF
     body text is a live risk** with this font setup, not just currency symbols — checked the rest
     of the render/PDF code for other arrows/checkmarks/bullets and found none remaining.
9. **QC's Reports gap — deliberately deferred, not forgotten.** Real candidates identified and
   scoped, off existing data with no schema change, but explicitly held back this round: **QC
   Inspection Summary** (`qc_records` by test_type/result over a period — the full-picture
   complement to Rework/Rejection, which only shows fails), **Calibration Due/Status**
   (`calibration_items`' derived expired/due_soon/ok/blocked state — a real compliance report),
   **Job-Work Inspection Register** (`job_work_inspections`' sent/received qty variance by period).
10. **`/executive/reports` sidebar — DONE (2026-08-22), now genuinely populated.** Graduated from a
    single card to `ExecutiveReportsWorkspace.jsx`'s `WorkspaceSidebar`, same round as items 8/9
    above — and immediately filled with 4 more Management reports the same day (below), so the
    "one-line addition, not a rewrite" claim got exercised the same session it was made.
11. **Four new Management reports — DONE (2026-08-22).** `/executive/reports` goes from 1 entry to
    5. All requirePM-gated (not department-gated — see item 2's placement reasoning), all reusing
    existing compute functions, no new ledger math:
    - **Project Profitability** — loops `getProjectCosting()` (material+labor vs. selling value,
      already built for the per-project Costing view) across every project in a period. The
      highest-value number a director didn't have: margin by project, company-wide.
    - **Customer Profitability** — same data, grouped by customer instead of project.
    - **Procurement Spend** — `getPurchaseRegisterLines()` grouped by supplier instead of listed per
      bill; no new SQL at all.
    - **Manufacturing Performance Summary** — the director-altitude headline for the shop floor
      (WO throughput/on-time count, rejection rate, material yield, cost variance), built entirely
      from the four Production department reports' own data functions
      (`getWorkOrderRegisterLines`/`getReworkRejectionData`/`getMaterialUtilizationLines`/
      `getProductionCostVarianceLines`) — same "headline vs. ledger" relationship the Management
      Report has to Trial Balance/P&L, applied to manufacturing. Deliberately excludes OEE/machine
      downtime — `workstations` has no availability calendar or breakdown log (SYSTEM.md §8's own
      documented gap), so the report doesn't fabricate a number the data can't back.
    - **Working Capital** added as a tile to the existing Management Report (Cash + AR + Inventory
      − AP) rather than its own sidebar entry — one more stat on a report that already computes
      AR/AP, not a near-empty new tab for one number.
    - **`StatGrid`** (the fixed-width stat-tile grid built for the Management Report) promoted from
      `lib/reports/management-report-pdf.js` into the shared `lib/report-pdf.js` once Manufacturing
      Performance Summary needed the same shape — same "promote once genuinely reused twice"
      precedent as `runningLedger()`/`agingBuckets()` in the original Report Engine build.
    - **A fourth instance of the `₹`/`→`-class glyph risk was checked for, not found** — this
      round's new PDF text was swept for other non-ASCII characters before shipping, not caught
      after.
    - **Honest limitation, not a bug**: Project/Customer Profitability's margin figures read as
      ~100% for nearly every project on the dev DB — not because the report is wrong, but because
      `getProjectCosting()`'s cost inputs (POs with `status='issued'`, logged job-card time) are
      largely empty here. The report is accurately surfacing thin cost-tracking data, the same class
      of caveat item 6 above already names for GSTIN sparsity — worth knowing before reading margin
      numbers as real business signal on this dataset.
    - **Deliberately not built this round**: Order Profitability (same economics as Project
      Profitability — a project *is* its Sale Order here, would be a near-duplicate view) and a
      separate "Company Performance Report" (no clearer definition than the Management Report
      already gives) — both flagged and explicitly skipped, not overlooked.

## 2. Polishing the reports that already exist (visual/UX) — DONE (2026-08-22), except #7

Concrete, mostly-mechanical fixes to `lib/report-pdf.js` and the catalog — these make every
existing report look better at once, not one report at a time. Items 1–6 are shipped and verified
against real data (Trial Balance, Customer Ledger, Vendor Ledger, Sales Invoice, Vendor Bill) via
the running dev server, not just eyeballed in isolation.

1. **Numeric columns right-aligned.** `<ReportTable>` cols now take an optional 4th tuple element
   (`align: 'right'`), applied via a new `tokens.cellRight` style. Every money/qty column in
   `lib/reports/render.js`'s column specs, plus the Sales Invoice/Vendor Bill item tables, is marked.
2. **Currency prefix added — but `Rs.` not `₹`.** Attempted the `₹` (U+20B9) symbol first; it
   silently rendered as a stray superscript digit (`¹`) in the actual PDF, because react-pdf's
   default Helvetica is a base-14 PDF font (WinAnsi encoding) with no glyph for it — no error, just
   wrong output, only caught by reading a real rendered PDF. Fixed by using the ASCII `Rs. ` prefix
   instead (`fmt(n, { currency: true })` in `lib/report-pdf.js`), which needs no font registration.
   On for Sales Invoice, Vendor Bill, Customer Ledger, Vendor Ledger; off for Stock Ledger/Cash Book
   (same shared row shape as the ledgers, but "balance" there is a quantity or internal-only) and
   every other internal report.
3. **Negative balances parenthesized**, e.g. `(Rs. 17,700.00)` — folded into the same `fmt()` change
   as #2 since both are formatting-level. Verified live on a Vendor Ledger with a real credit
   balance.
4. **"Generated by" attribution added to the footer** — `ReportFooter`/`ReportPage` take a
   `generatedBy` prop, threaded from `getFreshSessionUser().username` through
   `app/api/reports/[key]/export/route.js` (all catalog reports) and the Sales Invoice/Vendor Bill
   PDF routes individually.
5. **Empty-state fallback added** — "No data for this period." renders in `renderCatalogPdf` when a
   section has columns but zero rows; GSTR-3B's genuinely-tableless case is untouched. Verified live
   on a Customer Ledger with no postings.
6. **Landscape added for the widest reports** — GSTR-1, ITC Reconciliation, Purchase Register, and
   Sales Register now carry `orientation: 'landscape'` in their catalog entry, wired through
   `renderCatalogPdf`.
7. **No page-break control beyond the repeating header** — NOT done, left as-is. Still minor/only
   shows up on long multi-section documents (GSTR-1's B2B/HSN split), unlike 1–6 which were cheap
   and visible everywhere.

**A layout side-effect surfaced by #2:** adding the `Rs. ` prefix pushed Sales Invoice/Vendor Bill's
`Rate` column (previously 12% width) into wrapping onto two lines. Fixed by widening `Rate` to 16%
and narrowing `Description` from 32% to 28% in both `lib/sales-invoice-pdf.js` and
`lib/vendor-bill-pdf.js`.

## 3. What NOT to do

Matching the plan's own restraint: don't build Excel just to check a box (§9's real question —
`xlsx` vs `exceljs` — needs an actual answer first, not a rushed default). Don't invent a Supplier
Performance metric to unblock it faster. Don't build the Monthly Management Report as three
duplicate reports wearing a trenchcoat. The system doesn't need more reports to feel mature right
now — it needs the ones that exist to be trustworthy (audited, complete inputs) and legible
(aligned, currency-marked, parenthesized negatives) more than it needs raw count.
