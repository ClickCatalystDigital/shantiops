# Report / Document Engine — Plan

Scope: a reusable reporting layer that turns the data Shanti Ops already manages into professional,
printable, audit-friendly business documents — PDF, Excel, and on-screen — instead of one more
accounting or workflow module.

## 0. Status (as of 2026-08-22)

**Phases 1 and 2 of §10 are shipped and verified against real data** (screen/JSON/PDF numbers
checked to agree on every report — ground rule 2). The actual build diverged from this document's
original §5 proposal in one deliberate way, kept per an explicit critique before implementation
started: **no declarative Report Definition config DSL.** The 9 pre-existing PDFs (§3) are not
tabular-generic — a PO has terms/totals/sign-off blocks matching a hand-made letterhead, QC Form
IV A is an 18-column landscape statutory form — so a single column/group/total template could never
render them, exactly as §9 already suspected. What got built instead:

- **`lib/report-pdf.js`** — the shared frame every report actually asked for: a uniform identity
  header (company name/GSTIN/address + title), a uniform footer (page X of Y, generated timestamp),
  and a `<ReportTable>` primitive whose header row repeats on every page (`fixed`) — none of the
  original 9 PDFs did this because none of them spanned more than a page or two; report tables
  (ledgers, GSTR summaries) regularly do. Streamed (`renderToStream`), not buffered, so a large
  report doesn't sit fully in memory before the response starts.
- **`lib/reports/catalog.js`** — one entry per report: `{ key, title, department, compute, toTable,
  totals?, subtitle?, heavy?, needsCompany?, hasOwnPdfControl? }`. `compute` is the exact function
  the report's own JSON route already imports (ground rule 2, enforced by construction, not
  discipline). `toTable`/`totals` are small, per-report, hand-written — genuinely not generic across
  reports whose shapes differ this much (confirmed while building: Trial Balance is
  `{accounts, totalDebit, totalCredit}`, GSTR-1 is two separate tables — B2B and HSN, matching the
  GST portal's own Table 4/Table 12 split — GSTR-3B is pure totals with no table at all).
- **`app/reports/page.js` + `components/ReportsWorkspace.jsx`** — the "Reports" main tab, catalog-
  driven: a department only gets the tab if it has ≥1 entry in the catalog (`REPORT_DEPARTMENTS`,
  computed server-side and passed into `components/Nav.jsx` as a prop, since the catalog pulls in
  server-only DB code and can't be imported from a client component).
- **Migrated onto the shared frame**: `lib/bom-pdf.js`, `lib/packing-pdf.js`, `lib/payslip-pdf.js`
  (opportunistic — verified against real production PDFs before/after). **Left untouched, as
  planned**: `lib/po-pdf.js`, `lib/qc-doc-pdf.js`, `lib/qc-folder-pdf.js` — statutory/sample-matched,
  migrate only once re-verified against the real sample.
- **Excel — DONE (2026-08-24), see REPORT-ENGINE-MATURITY.md §1.1.** Shipped on the already-installed
  `xlsx` (SheetJS) build via `lib/reports/excel.js`, exactly the "second consumer of `toTable()`"
  shape anticipated here — no rewrite. Right-aligned columns write real numeric cells (not the PDF's
  formatted display string), so Excel's own SUM/sort work; `exceljs`/cell-styling is still the
  unaddressed half of the original gap.
- **Project Costing / Work Order Costing turned out to be per-record documents**, not catalog-style
  reports — reached from a project's/work order's own page (like the BOM/PO PDF pattern), not picked
  off a Reports-tab list. They're `lib/project-costing-pdf.js` / `lib/work-order-costing-pdf.js` +
  `app/api/projects/[id]/costing-pdf` / `app/api/work-orders/[id]/costing-pdf`, not entries in
  `lib/reports/catalog.js`.

**Shipped catalog** (`lib/reports/catalog.js`): Accounts — Trial Balance, Customer Ledger, Profit &
Loss, Balance Sheet, GSTR-1/IFF, GSTR-3B, ITC Reconciliation, Receivables Aging, Payables Aging,
Vendor Ledger, Cash/Bank Book, Journal Register (12). Stores — Stock Valuation, Inventory Aging,
Stock Ledger (3, `needsCompany: false` — Stores is one shared warehouse, no per-legal-entity split).
Procurement — Purchase Register (1). Sales — Sales Register (1). Production — Material Consumption
Report (1). **19 total**, all verified screen+PDF against real data. Plus 4 per-record PDFs outside
the catalog (Project Costing, Work Order Costing, Sales Invoice, Vendor Bill) — **23 documents
shipped overall**.

Bank Reconciliation Statement (§8's "worth adding" list) turned out cheap once the pattern was
established — its JSON route already existed (`app/api/reports/bank-reconciliation`, screen-only
before this), same "extract computeX(), register in catalog" wrap as P&L/Balance Sheet. Its report
card is a fresh, read-only one (`BankReconciliationReportCard.jsx`), not the operational
`AccountsWorkspace` tab — that one also carries the reconcile-toggle action, same reasoning as the
GSTR-1/3B/ITC split.

See **`REPORT-ENGINE-MATURITY.md`** for what would make this reporting layer read as fully mature
(Excel, report-access audit trail, a real Management Report composite, Production's thin coverage)
and concrete visual polish gaps found while verifying (numeric columns aren't right-aligned in any
report table — real, checked in `lib/report-pdf.js`; no currency symbol; negative balances don't use
accounting-style parentheses).

`lib/ledger.mjs`'s `customerLedger()` was renamed `runningLedger()` once Vendor Ledger, Cash/Bank
Book, and Stock Ledger turned out to need the exact same running-balance rollup (quantity instead of
money for Stock Ledger — the math is identical either way) — one function, four callers, instead of
four copies of the same ~10 lines. Same reasoning produced `agingBuckets()`, shared by Receivables
Aging, Payables Aging, and Inventory Aging (days since last movement instead of days overdue).

**Inventory Aging and Stock Ledger were initially flagged blocked** ("no obvious direct link from
receipts/issues to `inventory_items`") — corrected on a second, closer look: the join exists via
`vendor_bill_items`/`material_issues` → `bom_items.item_id` → `inventory_items.item_id`, the exact
join `lib/db.js`'s Vendor Bill approval already uses to update `avg_cost`. Confirmed by reading that
route rather than guessing.

**Real bug caught while verifying Stock Ledger, fixed in `getCustomerLedgerLines`/
`getVendorLedgerLines`/`getStockLedgerLines` (`lib/data.js`):** same-day rows were sorted
alphabetically by document kind (`'Credit Note' < 'Invoice'`, `'Issue' < 'Receipt'`), which could
order a credit note before the invoice it's against, or a stock issue before the receipt that
stocked it — producing a nonsense negative intermediate running balance (the *closing* balance was
always still correct, since order doesn't affect a sum; only the line-by-line story a reader sees
was wrong). Fixed with an explicit `sort_rank` column per document type (source doc, then
adjustment, then settlement) — SQLite forbids a `CASE` expression directly in a compound/`UNION ALL`
query's `ORDER BY`, so the rank has to be a real selected column, not just referenced. Verified fixed
across all three reports with real data (no more negative intermediate balances).

**Known, deliberate gap**: Sales/Marketing's pre-existing `/crm-reports` tab (a different,
browser-print mechanism — `components/ReportKit.jsx`, `window.print()` against a live dashboard, no
generated PDF) is unrelated to this catalog but is *also* labeled "Reports" in the nav. A PM/
executive/admin user who sees every department tab sees "Reports" twice, pointing to different
places, until `/crm-reports` is folded into this catalog — not done in Phases 1–2, real scope beyond
what they cover.

Also shipped (per-record documents, same reasoning as Project/WO Costing — not catalog entries):
**Sales Invoice PDF** (`lib/sales-invoice-pdf.js`, `app/api/sales-invoices/[id]/pdf`, gated Sales,
download button in `SalesWorkspace.jsx`'s Invoices tab) and **Vendor Bill PDF**
(`lib/vendor-bill-pdf.js`, `app/api/vendor-bills/[id]/pdf`, gated Procurement, download button in
`ProcurementWorkspace.jsx`'s Vendor Bills tab) — both verified against real records.

**Inventory Aging and Stock Ledger — shipped, see §0's correction above** (initially flagged
blocked, then built once the real join was confirmed by reading the code, not guessed).

**Deliberately not built as separate reports:** Cash Position / Receivables Exposure / Payables
Exposure — these are literally the same totals `cash-book`/`ar-aging`/`ap-aging` already produce
(their `closingBalance`/`total`); a real Monthly Management Report should combine several reports on
one page, which is a bigger, real design task, not three duplicate single-metric catalog entries.

**Data gap found while verifying (not a Report Engine bug):** Sales Invoice SB/13/2026-27 has
`cgst_amount`/`sgst_amount`/`igst_amount` all `0` despite a non-zero `tax_amount` (₹7,56,000) and a
correct `total` — the PDF correctly renders nothing fabricated (it only shows tax lines that are
actually populated), but whatever created this invoice isn't writing the GST split columns. Worth
checking the invoice-creation flow separately; out of scope for this pass.

Not started: Vendor Statement, Customer Statement (both would just be reformats of Vendor/Customer
Ledger already built — skipped as pure duplication, not a real gap), Stock Ledger, Material
Consumption Report, Supplier Performance (§9: still needs its on-time-delivery definition decided
first), the real Monthly Management Report/Company Performance composites, §8's "worth adding" list,
and Excel.

## 1. The core idea

A mature ERP isn't perceived as mature because it has hundreds of screens. It's perceived as
mature because it can produce authoritative business documents and reports from the data it
already manages. Shanti Ops has spent five phases building the data (BOM, POs, Vendor Bills, the
GL, GST compliance, Work Orders, QC records) — the highest-ROI next investment is making that data
*visible and exportable*, not adding more capability nobody can see in one document.

```
                 SHANTI OPS
                     │
       ┌─────────────┼─────────────┐
       │             │             │
     ERP/CRM       Operations    Accounts
       │             │             │
       └─────────────┼─────────────┘
                      ↓
               REPORT ENGINE
                     │
          ┌──────────┼──────────┐
          ↓          ↓          ↓
        PDF        Excel      Screen
```

The feature is never "PDF." The feature is: **every important business record and report can be
generated as a professional, printable, audit-friendly document** — PDF for filing/signing/sharing,
Excel for analysis, screen for a quick look — from the same underlying query.

```
Customer  →  Customer Ledger  →  [View]  [Export Excel]  [Generate PDF]
Vendor    →  Vendor Statement →  [View]  [Export Excel]  [Generate PDF]
Project   →  Project Cost     →  [View]  [Export Excel]  [Generate PDF]
```

**10 excellent reports beat 80 decorative ones.** Every report on this list has to answer a real
operational or accounting question someone actually asks; nothing here exists to inflate a feature
count.

## 2. Explicitly separate: file uploads / Cloudflare R2

Shanti Ops already has a working file-storage system — `lib/r2.js`, Cloudflare R2 (S3-compatible),
used today for **uploaded** artifacts: Test Certificate PDFs and AutoCAD/calc-drawing files
(`app/api/test-certificates/[id]/pdf`, `app/api/calc-drawings/[id]/upload`, and siblings). That
system exists because those files are created *outside* Shanti Ops (a scanned certificate, a CAD
export) and need somewhere durable to live.

The Report Engine is the opposite case: every document below is generated *from data Shanti Ops
already has*, on demand, at request time. It needs no storage — the PDF/Excel is a rendering of a
live query, not a file someone uploaded. **Do not route generated reports through R2** just because
R2 already exists; that would be storing something that's cheaper and more correct to regenerate
than to keep in sync. The two systems solve different problems and should stay architecturally
separate: R2 for what someone hands you, the Report Engine for what Shanti Ops itself can prove
from its own data.

## 3. What already exists (don't rebuild this)

Shanti Ops already generates real PDFs today, one bespoke module per document — this is the proof
the pattern works, and the seed the engine should generalize from, not throw away:

| File | Document | Shared frame (§0)? |
|---|---|---|
| `lib/po-pdf.js` | Purchase Order | No — statutory/sample-matched, left alone |
| `lib/quotation-pdf.js` | Quotation | No |
| `lib/sos-pdf.js` | Scope of Supply | No |
| `lib/bom-pdf.js` | BOM | **Yes** — migrated, verified against real data |
| `lib/packing-pdf.js` | Packing List / Dispatch | **Yes** — migrated (footer + table only; kept its own header, see §0) |
| `lib/payslip-pdf.js` | Salary Slip | **Yes** — migrated, verified against real data |
| `lib/calc-report-pdf.js` | Calculation Sheet snapshot | No |
| `lib/qc-doc-pdf.js` | QC statutory document (Form IV A) | No — statutory/sample-matched, left alone |
| `lib/qc-folder-pdf.js` | QC statutory folder assembly | No |

All nine use `@react-pdf/renderer`. There is exactly **one** existing Excel export
(`lib/calc-export.js`, Calc Sheet methodology) and no on-screen "view as report" pattern separate
from each module's own workspace UI. In short: the PDF half of this vision is already proven nine
times over in isolation; what's missing is (a) a shared Report Engine so document #10 is cheap
instead of another bespoke module, (b) Excel as a first-class second output next to every PDF, and
(c) the report catalog below — most of which (ledgers, aging, registers, valuation, profitability)
has no document at all today, only a live screen.

## 4. Where QC already is (so this doesn't re-propose it)

QC's own statutory-document work is already mid-flight and follows exactly this shape — worth
folding into the same engine rather than treating as separate:

- **Shipped**: Test Certificate bank (reusable material certificates) + **Form IV A** — a real,
  landscape PDF (`lib/qc-doc-pdf.js`, 18-column part table, parts auto-populated from the
  project's own BOM via `lib/qc-bom-sync.js`) generated from the saved statutory-document record.
- **In progress, blocked**: a complete statutory folder is more than Form IV A alone — the filed
  order for CF/MF/OF boilers is **Form II(1) + III + III A + IV A** (SF adds a Mountings sheet);
  PRS/Steam Header units file **Form III + Form IV A**. Form III A (per-part TC table, one named
  part), Form III (boiler description block — dimensions, W.P., hydro test ref, safety-valve test),
  and Form II(1) (the inspecting-authority certificate) are designed but not built — `lib/qc-folder-pdf.js`
  exists to assemble the multi-form folder once they are. **Blocked on real client sample files**
  for each form's exact layout, same "get a real sample, don't design speculatively" rule this repo
  applies everywhere else.
- **Also live**: Job-Work Inspection and Calibration Item tracking (STERP Priority 4), currently
  screen-only, no PDF yet.

This is exactly the "GST summaries," "GSTR-1 working report" pattern below, one department earlier
— a statutory document assembled from records Shanti Ops already holds. Once the Report Engine
exists, finishing QC's folder is "add the II(1)/III/IIIA templates as report definitions," not a
separate PDF subsystem.

## 5. Proposed architecture: one Report Engine, not N bespoke PDFs

**This section is the original discovery-phase proposal — §0 records what was actually built,
which is smaller and less generic than the config-object idea below.** No declarative Report
Definition DSL got built; every report's `toTable()`/`totals()` is a small hand-written function
(`lib/reports/render.js`), because the reports built so far don't actually share a column/group/
total shape closely enough for a generic mapper to be honest (confirmed while building, not assumed
in advance — see §0's GSTR-1/GSTR-3B examples).

```
Report Definition
├── title
├── filters        (company, date range, project, customer/vendor, status…)
├── columns         (field, label, format, align)
├── grouping         (e.g. by HSN, by customer, by account)
├── totals           (sum/subtotal/grand total rows)
├── company identity  (GSTIN/PAN/address — company_settings, already exists)
├── date range
├── page header/footer
├── approval/signature area (optional, per-document)
└── output: PDF | Excel | Screen
```

A report definition is a small, declarative object (query + column/group/total spec); one shared
renderer turns it into a PDF (react-pdf, matching the existing house style) or an Excel workbook
(`xlsx`, matching `lib/calc-export.js`'s existing shape). Adding report #11 becomes "write a query
and a column list," not "write a new PDF module from scratch" — the same economics that made the
nine existing PDFs individually cheap, now shared instead of duplicated.

**Non-goals**: no report-builder UI for end users (definitions are code, reviewed like any other
report), no scheduled/emailed reports in v1, no cross-tenant/white-label templating — this is an
internal reporting layer for two known legal entities, not a general BI product.

## 6. Ground rules (non-negotiable, apply to every report built under this plan)

1. **Never build a report on data the system doesn't actually have.** If a number isn't derivable
   from what's already in the schema today, the report waits for that data to exist — it doesn't
   get built on a guess or a placeholder. This is already how the catalog in §7 is marked (`exists`
   vs `new`) and why §9's "worth adding" list explicitly excludes a Fixed Asset Register/Depreciation
   Schedule until Phase 7 actually builds that register.
2. **One computed result, three renderers — never three calculations.** Not just "the same query"
   (a query can still be post-processed differently per renderer) but literally: the report route
   computes its numbers once per request into a plain result object, and the PDF renderer, the Excel
   renderer, and the screen view all consume that same object unmodified. This is what actually
   prevents the failure mode where Trial Balance shows ₹10,00,000 on screen, ₹9,80,000 in the PDF,
   and ₹10,20,000 in Excel because each output quietly reimplemented rounding or a filter slightly
   differently. If a renderer needs a number the shared object doesn't have, that's a bug in the
   shared computation to fix, never a reason to let the renderer compute its own version.
3. **Prove the engine on a small, deliberately mixed set before expanding the catalog.** Not the
   whole list in §7 — see §10's pinned first-10 for exactly which ones and why.

## 7. Report catalog

Marked **exists (screen)** where Shanti Ops already computes/shows this live but has no PDF/Excel
output yet — those are the cheapest wins, since the query already exists. Marked **new** where the
underlying data exists but nothing currently surfaces it as a report at all.

### Sales / CRM
- Quotation — **PDF exists** (`lib/quotation-pdf.js`)
- Sales Order — new (thin data today — `sale_orders` carries no amount fields, see
  ACCOUNTING-READINESS.md §4 — a real Sales Order PDF is limited until that's addressed)
- Sales Invoice — **shipped** (per-record PDF, not catalog — see §0; `lib/sales-invoice-pdf.js`)
- Customer Statement — new
- Receivables Aging — new (real data now: `customer_receipts` against `sales_invoices`)
- Sales Register — new
- Customer Ledger — **shipped** (Report Engine, gated under Accounts — see §0; this list's own
  "Accounts" section carries the same item, not duplicated)

### Procurement
- Purchase Order — **PDF exists** (`lib/po-pdf.js`)
- Vendor Bill — **shipped** (per-record PDF, not catalog — see §0; `lib/vendor-bill-pdf.js`)
- Vendor Statement — new (deliberately not built — see §0, would just be a reformat of Vendor Ledger)
- Payables Aging — **shipped** (Report Engine, real data: `vendor_payments` against `vendor_bills`)
- Purchase Register — new
- Supplier Performance — new (on-time delivery, quality reject rate — needs a defined metric, see §8)

### Stores
- Goods Inward / GIR — **exists (screen)**, `gate_inward_receipts`
- Gate Pass — **exists (screen)**, `gate_passes`
- Material Issue — **exists (screen)**, `material_issues`
- Stock Ledger — **shipped** (Report Engine, per-item receipts/issues via `bom_items.item_id`,
  screen + PDF, `computeStockLedger`)
- Stock Valuation — **shipped** (Report Engine, `inventory_items.on_hand × avg_cost`, screen + PDF,
  `lib/data.js`'s `getStockValuation`)
- Inventory Aging — **shipped** (Report Engine, days since last movement, screen + PDF,
  `computeInventoryAging`)
- Reorder Report — **exists (screen)**, `inventory_items.reorder_point` vs `on_hand`

### Production
- Work Order — **exists (screen)**
- BOM — **PDF exists** (`lib/bom-pdf.js`, migrated onto the shared frame — see §0)
- Material Consumption Report — **shipped** (Report Engine, `material_issues.total_cost`)
- Production Progress — **exists (screen)**, Job Card completion per milestone
- Job Card / Process Route Card — new (a printable shop-floor traveler)
- Production Cost Report / Work Order Costing — **shipped**, but as a per-record PDF (like BOM/PO),
  not a Report Engine catalog entry — see §0. `lib/work-order-costing-pdf.js` +
  `app/api/work-orders/[id]/costing-pdf`, linked from the Work Order panel.
- Project/WIP Cost — **shipped**, same per-record pattern. `lib/project-costing-pdf.js` +
  `app/api/projects/[id]/costing-pdf`, linked from Sales' Costing sheet.

### Accounts
- General Ledger — **exists (screen)**, `app/api/journal-entries`
- Trial Balance — **shipped** (Report Engine — screen + PDF, `app/api/reports/trial-balance`'s
  exported `computeTrialBalance`)
- P&L — **shipped** (Report Engine — screen + PDF, `computeProfitLoss`)
- Balance Sheet — **shipped** (Report Engine — screen + PDF, `computeBalanceSheet`)
- Cash/Bank Book — new (chronological Bank & Cash ledger — the data behind Bank Reconciliation, reframed as a statement)
- AR Aging — new
- AP Aging — new
- Customer Ledger — **shipped** (Report Engine, new query — `lib/data.js`'s `getCustomerLedgerLines`
  + `lib/ledger.mjs`'s `customerLedger()`, screen + PDF, per-customer type-ahead picker)
- Vendor Ledger — new
- Journal Register — new (chronological `journal_entries`, distinct from the per-account GL view)
- GST summaries — new
- GSTR-1 working report — **shipped** (Report Engine — screen + PDF, two-section PDF matching the
  GST portal's own B2B/HSN table split, `computeGstr1`)
- GSTR-3B working/reconciliation report — **shipped** (Report Engine — screen + PDF, totals-only
  document, no table, `computeGstr3b`)
- ITC reconciliation report — **shipped** (Report Engine — screen + PDF, `computeItcReconciliation`)

### Management
- Project profitability — **exists (screen)**, `getProjectCosting` (revenue side needs joining against Sales Invoice)
- Order profitability — new
- Customer profitability — new
- Procurement spend — new
- Inventory valuation — new (same data as Stock Valuation above, company-wide roll-up)
- Production cost variance — **exists (screen)**, Work Order Costing's planned-vs-actual
- Receivables exposure — new (same data as AR Aging, company-wide)
- Payables exposure — new (same data as AP Aging, company-wide)
- Cash position — new
- Monthly management report — new (a composite: the above, one document)
- Company performance report — new

## 8. Reports worth adding beyond the original list

A few real, commonly-asked questions this catalog doesn't yet cover — flagged for judgment, not
pre-approved, same "answers a real question" bar as everything above:

- **PF / ESI Registers** — already an explicit open item (ACCOUNTING-READINESS.md §7 rows 62–63);
  natural fit here once built, generated from `salary_slips`.
- **Bank Reconciliation Statement — shipped, see §0** (reconciled/unreconciled, as of a date).
- **Day Book** — every voucher (invoice, bill, receipt, payment, journal entry) for one day,
  chronological — the classic first report an external auditor or accountant asks for.
- **Stock Reconciliation / Physical Verification report** — a variance sheet (system qty vs.
  counted qty) for a cycle count; Stores has no such workflow today, but the report shape is worth
  scoping alongside Stock Valuation since they share the same query surface.
- **Non-moving / Dead Stock report** — a sharper cut of Inventory Aging (zero movement in N days),
  a real question Stores/Management ask that "aging" alone doesn't directly answer.
- **Rework / Rejection report** — QC's own reject data (Job Card `qty_rejected`, Hydro Test fails)
  rolled up by project/period — a real quality-cost signal nothing currently surfaces as a report.
- **Remnant Utilization report** — Cutting & Remnant Management already tracks reserved/cut/scrap
  per plate; a period roll-up (material saved vs. scrapped) is a genuine cost story worth telling.
- **Vendor Compliance report** — GSTIN/PAN presence and validity per active supplier (`suppliers.gst_no`
  sparsity is already a known data-quality gap per ACCOUNTING-READINESS.md) — useful both operationally
  and as an audit-readiness signal.
- **Working Capital snapshot** — AR + Inventory Valuation − AP, one number, alongside Cash Position —
  the single figure a management report's reader usually wants first.

Deliberately **not** proposed: budget-vs-actual beyond what Work Order Costing already gives
(explicit Phase 5 non-goal), any multi-currency reporting, any scheduled/emailed report delivery,
any report requiring data this app doesn't have yet (e.g. a true Fixed Asset Register/Depreciation
Schedule waits on Phase 7 actually building that register first — the report follows the data, not
the other way round).

## 9. Open questions before building

- **Supplier Performance's metric.** "On-time delivery %" needs a defined comparison (PO promised
  date vs. GRN/bill date — neither field is consistently populated today); decide the real
  definition before building the report, not after.
- **Excel vs. PDF as the default per report.** The source material's instinct — Accounts wants
  Excel for analysis, everyone else mostly wants PDF for filing/sharing — is probably right, but
  worth confirming per-department rather than assuming; cheap to offer both regardless, since one
  engine renders either from the same definition.
- **Signature/approval blocks.** Some of these (Vendor Statement, Customer Statement, the GL/TB/BS
  set) plausibly need a signature area for external use; decide which ones per-document, not as a
  blanket default.
- **GST and statement layouts may not be generic-template-shaped.** GSTR-1/3B working reports
  plausibly need to resemble the GST portal's own B2B/HSN summary layout (so someone can eyeball-check
  against the portal, not just get "a table"), and Customer/Vendor Statements are an external,
  signed document with their own house format — both may need a layout override on top of the
  generic Report Definition template, not just its default column/total rendering. Don't assume the
  first 10 (§10) all fit the generic template equally well; confirm this while building #4–#6.

## 10. Phasing — pinned first 10, then expand

Not every report in §7 gets built before the engine is proven (ground rule 3). The first 10 are
pinned deliberately, not left as "candidates": three genuinely new queries to prove the engine
handles data it doesn't already compute, then seven wraps of numbers Shanti Ops already computes on
screen today, to prove the same engine handles "just render what already exists" just as cheaply.

**Phase 1 — prove the engine (new queries): ✅ shipped 2026-08-22**
1. ✅ Trial Balance
2. ✅ Customer Ledger
3. ✅ Stock Valuation

(The signature/approval block idea in the original line 1 wasn't built — no shipped report needed
one yet; revisit when a report that's meant to leave the building, like Customer Statement, needs it.)

**Phase 2 — wrap what already exists on screen (no new data model work): ✅ shipped 2026-08-22**
4. ✅ GSTR-1 — resolved the GST-layout question (§9): needed a two-section PDF (B2B + HSN), not the
   generic single-table template. `renderCatalogPdf` was extended to support named sections for
   exactly this.
5. ✅ GSTR-3B — turned out to need zero table rows, totals only; `renderCatalogPdf` skips the table
   when a report's `toTable()` returns `{cols:[], rows:[]}`.
6. ✅ ITC Reconciliation
7. ✅ P&L
8. ✅ Balance Sheet
9. ✅ Project Costing — turned out to be a per-record document (like BOM/PO), not a catalog entry —
   see §0.
10. ✅ Work Order Costing — same per-record pattern as #9.

All 10 verified against ground rule 2 with real data (screen/PDF numbers checked to match exactly,
not just code review) — see §0 for what's shipped and what's explicitly deferred (Excel, §7's wider
catalog, §8's "worth adding" list, the `/crm-reports` merge).

**After the first 10, in order:**
- The AR/AP/ledger set — Receivables/Payables Aging, Vendor Ledger & Statement, Cash Book, Journal
  Register, Purchase/Sales Register — new queries, but straightforward joins over Phase 5's data.
- Management composites — Monthly Management Report, Company Performance, profitability reports —
  these are aggregates of everything above, so they're naturally last.
- QC's statutory folder (§4) can proceed in parallel once real Form II(1)/III/IIIA samples arrive —
  it's the same engine, just blocked on external input, not sequencing.
