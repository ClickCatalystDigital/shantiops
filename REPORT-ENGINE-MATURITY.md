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
2. **A real Monthly Management Report.** Right now every report is single-purpose. A mature system
   has *one* document a director opens on the 1st of the month — Trial Balance summary, AR/AP
   exposure, cash position, top-line P&L — combined on one page. Deliberately not built yet (see
   REPORT-ENGINE-PLAN.md §0) because three duplicate single-metric reports would have been worse
   than nothing; a real composite is a distinct, larger design task (layout, what belongs on page
   1 vs. an appendix, whether it's per-company or combined).
3. **Report access isn't audited.** Every write path in this app calls `audit()` (see `lib/usb.js`
   usage throughout `app/api/*`); no report PDF/JSON export does. For financial documents
   specifically ("who pulled the Trial Balance for FY26-27 and when") this is the kind of thing an
   external auditor actually asks. Cheap to add — one `audit('report_exported', {actor, key,
   params})` call in `app/api/reports/[key]/export/route.js`, generic across every report by
   construction.
4. **Production reporting is thin.** Two per-record costing PDFs and one Material Consumption
   Report is the whole department's coverage. Job Card / Process Route Card (a printable shop-floor
   traveler) is real, unbuilt, and probably the next-highest-value Production report if this keeps
   going.
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

## 2. Polishing the reports that already exist (visual/UX)

Concrete, mostly-mechanical fixes to `lib/report-pdf.js` and the catalog — these make every
existing report look better at once, not one report at a time.

1. **Numeric columns aren't right-aligned.** Checked `lib/report-pdf.js`'s `tokens.cell` — no
   `textAlign` is set, so every column (including Debit/Credit/Amount/Qty) defaults left, same as
   every text column. Every financial document convention right-aligns money/quantity columns for
   scannability (can you eyeball-sum a column of left-aligned numbers of different lengths? not
   easily). Real, visible in every report generated so far — confirmed by re-looking at the PDFs
   already produced this session. Fix: `<ReportTable>` cols already carry a `get` function per
   column; adding an optional 4th tuple element (`align: 'right'`) and applying it in the cell style
   would fix every numeric column across every report in one change, not per-report.
2. **No currency symbol.** Every amount renders as a bare number (`41,000.00`) — no `₹` prefix
   anywhere. Reasonable for an internal working report, questionable for anything handed to a
   customer/vendor/auditor (Sales Invoice, Vendor Bill, Customer/Vendor Ledger). Cheap: `fmt()` in
   `lib/report-pdf.js` could take an optional currency-symbol flag, defaulted off for internal
   reports and on for the four "leaves the building" documents.
3. **Negative balances read as `-1,00,000.00`.** Accounting convention is parentheses,
   `(1,00,000.00)`, specifically so a stray minus sign in dense numeric text doesn't get missed.
   Worth it for Customer/Vendor Ledger and Trial Balance especially, where a negative running
   balance is a real, meaningful state (customer in credit / overpaid vendor) that should be
   visually unmistakable, not just numerically correct.
4. **No "Generated by" line.** The footer says *when* a PDF was generated and that it's
   computer-generated, not *who* generated it. For anything used as an audit trail (which several
   of these now genuinely are), that's a real, small gap — `getFreshSessionUser()` already has the
   username at the point every export route runs.
5. **Empty states are inconsistent.** Some reports show a friendly "No postings yet." (Trial
   Balance's screen card); the PDF path just renders an empty table with no rows at all, which can
   look like a rendering failure rather than "genuinely nothing to show." Worth a one-line "No data
   for this period" fallback in `renderCatalogPdf` when `rows.length === 0` (already special-cased
   for GSTR-3B's *no table at all*, but that's a different case from *this table happens to be
   empty right now*).
6. **Landscape vs. portrait wasn't a deliberate choice per report** — everything defaults portrait
   except the two migrated-from-existing-landscape docs (BOM, QC Form IV A). Wide tables (GSTR-1's
   HSN summary, ITC Reconciliation, Purchase/Sales Register) are already tight on a portrait A4;
   worth revisiting landscape for the widest ones specifically, not universally.
7. **No page-break control beyond the repeating header.** A table row is `wrap={false}` (never
   splits a row across a page break, good), but there's no control over *where* a section break
   falls — GSTR-1's B2B/HSN sections could split a section header from its own first row across a
   page boundary. Minor, only shows up on long documents.

## 3. What NOT to do

Matching the plan's own restraint: don't build Excel just to check a box (§9's real question —
`xlsx` vs `exceljs` — needs an actual answer first, not a rushed default). Don't invent a Supplier
Performance metric to unblock it faster. Don't build the Monthly Management Report as three
duplicate reports wearing a trenchcoat. The system doesn't need more reports to feel mature right
now — it needs the ones that exist to be trustworthy (audited, complete inputs) and legible
(aligned, currency-marked, parenthesized negatives) more than it needs raw count.
