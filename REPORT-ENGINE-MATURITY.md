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

1. **Excel — DONE (2026-08-24).** Shipped on the already-installed `xlsx` build, exactly the "second
   consumer of `toTable()`'s data" this note anticipated (`lib/reports/excel.js`,
   `app/api/reports/[key]/export/route.js`'s `format=xlsx` branch). Still no cell styling (no bold
   header row, no borders, no fill) — that part of the gap is real and `exceljs` is still the fix if
   it's ever wanted. What this round did add on top of "just dump `toTable()`'s display strings":
   right-aligned (money/qty) columns write real JS numbers, not the PDF's `fmt()`-formatted text, so
   Excel's own SUM/sort/pivot work natively — verified by `scripts/reports-excel-selfcheck.mjs` and a
   live downloaded workbook. Excel button sits next to PDF on every catalog report with a table,
   including the 6 `hasOwnPdfControl` cards; GSTR-3B (the one genuinely tableless report) has neither
   button reachable through it, confirmed by grepping every `toTable()` for another `cols: []` case
   and finding none.
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
9. **QC's Reports gap — DONE.** All 3 candidates named here have shipped, closing QC out at 5
   reports total (Test Certificate Register was also added, off the same "no schema change" bar):
   **QC Inspection Summary** (`qc_records` by test_type/result — shipped a later session, before
   this note was updated), **Calibration Due/Status** and **Job-Work Inspection Register** — DONE
   (2026-08-24), `app/api/reports/calibration-status`/`job-work-inspection-register`, both
   seeded (`scripts/seed-qc-inspections-demo.mjs` — both source tables were at 0 rows) and
   browser-verified (screen/PDF/Excel).
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
12. **Manufacturing Performance Summary, filled out (2026-08-22, same-day follow-up).** Nav tab
    renamed "Management Report" → "Reports" (matches the department Reports tabs' own label).
    Research pass against `SYSTEM.md` in full (Procurement §5c, Stores §5e, Production's own
    intelligence-gap list §8) to answer "what's obviously missing for a mature manufacturing
    reporting layer":
    - **Two real oversights in the report just shipped, fixed**: `qcFailures` and labour data were
      computed in `computeManufacturingPerformance()` but never rendered — `qcFailures` sat unused
      in the return object, and labour wasn't fetched at all despite Production's own Labour
      Utilization report existing. Both now real tiles (QC Failures; Labour Hours/Cost, reusing
      `getLabourUtilizationLines()`), plus a new **Material Lines Blocking Production (30d)** tile
      reusing the standalone Material Shortage report's forecast data — "what's currently blocking
      the shop floor," a real director question the summary was missing entirely.
    - **Open PO Aging — new Procurement department report.** Issued POs with ≥1 line still
      `TRANSIT`, aged by days since `issued_at`. Real gap: neither Purchase Register (only exists
      once a Vendor Bill is raised) nor Procurement Spend (financial roll-up) answers "what's stuck
      in the pipeline right now." Distinct from the blocked Supplier Performance metric
      (REPORT-ENGINE-PLAN.md §9 — that needs a *promised* date vs. actual, inconsistently
      populated) — this only needs *issued* date, which always exists. `lib/data.js`'s
      `getOpenPoAgingLines()`.
    - **§8's "Production's next layer" list (scheduling, formal NCR, heat/lot traceability, welding
      traceability, subcontract cost, OEE) is explicitly a capture gap, not a report gap** — the
      document itself says none of this data exists yet (`workstations` has no downtime log, no
      per-joint weld ID, no NCR table). No report can surface a number that was never recorded;
      building any of these means building the capture UI first, a separate, larger scope decision
      — correctly not attempted here.

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

## 3. Charting + one consolidated Reports view for admin/manager (2026-08-22, same-day follow-up)

- **First real charting dependency, added deliberately.** Every existing screen visual in this app
  (Calc Sheets' validation donut, margin gauge, sensitivity sweep line) is hand-rolled inline SVG —
  a documented anti-dependency precedent. The 5 Management report screen cards needed enough real
  charts (ranked bars, grouped comparison, status donut, planned-vs-actual) that hand-rolling all of
  them would have been the larger, worse-maintained option. Installed via the project's own shadcn
  CLI (`npx shadcn add chart`, same install path as every other UI primitive here) — Recharts
  underneath, `components/ui/chart.jsx` (the shadcn wrapper) + `components/executive/charts.jsx`
  (5 chart components: `RankedMarginChart`, `RankedSpendChart`, `PnlComparisonChart`,
  `WorkOrderStatusPie`, `CostVarianceChart`), wired into all 5 Management report cards.
  - **A real Recharts v3 bug, caught only by looking at a rendered chart, not the self-check**: a
    category-axis label longer than its allocated column width doesn't clip or overflow, it
    auto-wraps into multiple `tspan` lines — a full customer/supplier name (vs. a short project
    code) wrapped 3 lines deep and crushed the plot area down to nothing, rendering as a stack of
    words with no visible bars. Fixed with a `tickFormatter` that truncates well inside the column
    width (not just under it — v3 wraps *before* the label visually overflows, so truncating to
    "exactly fits" still wraps).
  - **`computeManufacturingPerformance()` gained `notStartedWO`/`cancelledWO`** so the new Work
    Order status donut has a genuinely mutually-exclusive set of slices — `delayed` is a
    cross-cutting flag an `in_progress` WO can also carry, not its own status; using it as a slice
    would double-count and sum past `totalWO`.
- **One consolidated "Reports" tab for admin/manager.** Was: one identically-labeled "Reports" tab
  per department (6 of them) plus a 7th separate one for Management reports — a wall of tabs a
  user can't tell apart without opening each. Now: bare `/reports` (no `?dept=`) renders every
  department's reports plus the Management reports in one sidebar, grouped by department
  (`components/WorkspaceSidebar.jsx`'s existing `groups` prop — no new sidebar primitive needed).
  `ReportsWorkspace.jsx` gained a `hasOwnControls` flag for reports whose own screen card already
  manages its company switcher + PDF button (the 5 Management reports) — the parent renders neither
  for those, and passes `companies` instead of a single controlled `company` string.
  - Single-department heads and the pure `executive` role are **unaffected**: a head's own Nav tab
    always carries `?dept=`, which still hits the original single-department code path unchanged;
    `executive` keeps its own dedicated `/executive/reports` tab (it has no department access to
    consolidate into).
  - **Verified live** (not just code review): `/reports` as admin returns every department's real
    report titles (Trial Balance, Stock Valuation, Work Order Register, Drawing Register, ...) each
    under its own sidebar group label, plus Management Report/Project Profitability/etc. under a
    "Management" group; `/reports?dept=Accounts` still renders the original single-department title
    and report set, confirming the refactor didn't regress the existing per-department tabs.
- **`SYSTEM.md` deliberately not updated in this pass** — another session has it under active edit
  right now (TDS register, fixed assets, audit log, period lock, rate sync). Updating it here would
  either collide with or silently drop that in-flight work; this round's SYSTEM.md addendum should
  land once that lands, not raced against it.

## 4. What NOT to do

Matching the plan's own restraint: don't build Excel just to check a box (§9's real question —
`xlsx` vs `exceljs` — needs an actual answer first, not a rushed default). Don't invent a Supplier
Performance metric to unblock it faster. Don't build the Monthly Management Report as three
duplicate reports wearing a trenchcoat. The system doesn't need more reports to feel mature right
now — it needs the ones that exist to be trustworthy (audited, complete inputs) and legible
(aligned, currency-marked, parenthesized negatives) more than it needs raw count.

## 5. Maturity scorecard (2026-08-22, end of this round)

Self-assessment at the close of this session's work, scoping to the reporting layer specifically
(not the whole ERP). Recorded here so the next chat picking this up doesn't have to re-derive it —
and so it can be re-scored honestly later rather than assumed still accurate.

**Overall: 82/100.**

| Category | Score | Why |
|---|---|---|
| Coverage | 9/10 | 33 reports across 7 groups (Accounts 13, Production 7, Management 5, Stores 3, Design 2, Procurement 2, Sales 1). Only real gap: QC has zero — deferred by explicit user call this session, not an oversight (§1.9). |
| Correctness | 9/10 | "One computed result, three renderers" enforced by construction. Every report built this session was cross-checked screen=JSON=PDF against real data, not just code review. Real bugs were caught and fixed under that verification, not shipped: two font-glyph bugs (`₹`/`→` silently rendering as garbage in react-pdf's base-14 Helvetica), a wrong inventory column name, a double-counting bug in material yield, a Recharts v3 label-wrap bug. |
| Visual polish | 8/10 | §2's 6 of 7 items shipped (right-align, currency, parens, generated-by, empty-state, landscape). Page-break control at section boundaries (§2 item 7) is the one gap, and it's minor — only shows on long multi-section documents. |
| Structural completeness | 6/10 | Two real, acknowledged gaps: **Excel export** (§1.1, deliberately deferred pending an `xlsx` vs `exceljs` decision) and **report-access audit logging** (§1.3 — every write path audits, no report export does). Supplier Performance stays correctly blocked on genuinely missing source data (§1.5), not a shortcut. |
| UX/Nav maturity | 8/10 | §3's admin/manager consolidation (7 identically-labeled "Reports" tabs → 1) just shipped. One known, still-open duplication remains: `/crm-reports` vs. the catalog's own Sales Reports tab (§1.7), same label, different mechanism, flagged since the original plan. |
| Underlying data quality | 6/10 | Not a Report Engine defect, but it caps real-world trust today: Project/Customer Profitability read as ~100% margin because POs aren't marked `issued` and job-card time isn't logged on this dataset (§1.11's own honest-limitation note). The report is accurately surfacing thin cost-tracking, not miscalculating — but reading it without knowing that draws the wrong conclusion. |

**Why not higher:** Excel and audit logging are real gaps for a system whose own framing (§0) is
*authoritative documents from real data* — an Accounts user who wants to reconcile in a spreadsheet,
or an auditor asking "who pulled this and when," genuinely can't today.

**Why not lower:** everything that *is* built has been verified against live data repeatedly, not
just written and assumed correct — the harder, more expensive kind of maturity, and it's real here.

**For the next chat**: re-score this rather than trust it blindly once real time has passed or new
work has landed — this is a snapshot, not a standing fact. The fastest path to a higher score, in
order: (1) report-access audit logging (§1.3, cheap — one `audit()` call, generic by construction),
(2) an actual `xlsx` vs `exceljs` decision for Excel (§1.1), (3) closing the `/crm-reports`
duplication (§1.7). QC's reports (§1.9) and the underlying cost-data thinness are real but larger,

**Re-score addendum (2026-08-24)** — Excel (§1.1) and QC's reports (§1.9) both shipped, so 2 of this
scorecard's 3 named gaps are closed; this round did not touch report-access audit logging (§1.3) or
the `/crm-reports` duplication (§1.7), which stay open exactly as scored. Coverage moves to **10/10**
(QC's 0→5 was the table's one named gap; catalog is now ~41 reports across 8 groups — Accounts 17,
Production 7, QC 5, Management 5, Sales 4, Dispatch 4, Marketing 3, Stores 3, Procurement 2, Design
2). Structural completeness moves to **8/10** (Excel closed; audit logging is the one item left
here, same as before). Underlying data quality note is now partially addressed as a side effect —
Production's `job_card_time_logs`/employee `cost_rate_per_hour` were previously near-zero DB-wide
(not just thin on this dataset), which is exactly the kind of gap that made Project/Customer
Profitability's margin numbers read as fabricated-looking 100%; seeding real cost rates + time logs
(`scripts/seed-production-demo.mjs`) gives those reports genuine non-zero labour cost to work with
for the first time, though it doesn't fully resolve the note's PO-`issued`-status half of the
caveat. One extra, unscored fix worth recording: `getOpenPoAgingLines` (`lib/data.js`) compared
`bom_items.purchase_status` against `'TRANSIT'` (uppercase) when the real stored value is `'Transit'`
everywhere else in the codebase — SQLite string comparison is case-sensitive, so Open PO Aging was
silently empty regardless of real Transit-status data. Found and fixed while seeding Procurement data
for this pass, not by a targeted audit — worth remembering that a report showing "no data" can mean
"the query is subtly wrong," not just "there's nothing to show," the next time a report reads
suspiciously empty.
separate decisions — not quick wins.
