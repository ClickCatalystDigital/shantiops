# Report / Document Engine — Plan

Discovery + proposal only. Nothing in this document is built. Scope: a reusable reporting layer
that turns the data Shanti Ops already manages into professional, printable, audit-friendly
business documents — PDF, Excel, and on-screen — instead of one more accounting or workflow
module.

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

| File | Document |
|---|---|
| `lib/po-pdf.js` | Purchase Order |
| `lib/quotation-pdf.js` | Quotation |
| `lib/sos-pdf.js` | Scope of Supply |
| `lib/bom-pdf.js` | BOM |
| `lib/packing-pdf.js` | Packing List / Dispatch |
| `lib/payslip-pdf.js` | Salary Slip |
| `lib/calc-report-pdf.js` | Calculation Sheet snapshot |
| `lib/qc-doc-pdf.js` | QC statutory document (Form IV A) |
| `lib/qc-folder-pdf.js` | QC statutory folder assembly |

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
  landscape PDF (`lib/qc-doc-pdf.js`, 18-column part table, `lib/qc-template.mjs`'s 54-part
  hardcoded template) generated from the saved statutory-document record.
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
- Sales Invoice — new (schema/data exists, `sales_invoices`, no PDF yet)
- Customer Statement — new
- Receivables Aging — new (real data now: `customer_receipts` against `sales_invoices`)
- Sales Register — new
- Customer Ledger — new

### Procurement
- Purchase Order — **PDF exists** (`lib/po-pdf.js`)
- Vendor Bill — new
- Vendor Statement — new
- Payables Aging — new (real data now: `vendor_payments` against `vendor_bills`)
- Purchase Register — new
- Supplier Performance — new (on-time delivery, quality reject rate — needs a defined metric, see §8)

### Stores
- Goods Inward / GIR — **exists (screen)**, `gate_inward_receipts`
- Gate Pass — **exists (screen)**, `gate_passes`
- Material Issue — **exists (screen)**, `material_issues`
- Stock Ledger — new (per-item movement history — receipts, issues, running balance)
- Stock Valuation — new (`inventory_items.on_hand × avg_cost`, real data since Phase 5's costing work)
- Inventory Aging — new
- Reorder Report — **exists (screen)**, `inventory_items.reorder_point` vs `on_hand`

### Production
- Work Order — **exists (screen)**
- BOM — **PDF exists** (`lib/bom-pdf.js`)
- Material Consumption Report — new (real data now: `material_issues.total_cost`)
- Production Progress — **exists (screen)**, Job Card completion per milestone
- Job Card / Process Route Card — new (a printable shop-floor traveler)
- Production Cost Report — **exists (screen)**, Work Order Costing (`getWorkOrderCosting`)
- Project/WIP Cost — **exists (screen)**, `getProjectCosting`

### Accounts
- General Ledger — **exists (screen)**, `app/api/journal-entries`
- Trial Balance — **exists (screen)**, `app/api/reports/trial-balance`
- P&L — **exists (screen)**, `app/api/reports/profit-loss`
- Balance Sheet — **exists (screen)**, `app/api/reports/balance-sheet`
- Cash/Bank Book — new (chronological Bank & Cash ledger — the data behind Bank Reconciliation, reframed as a statement)
- AR Aging — new
- AP Aging — new
- Customer Ledger — new
- Vendor Ledger — new
- Journal Register — new (chronological `journal_entries`, distinct from the per-account GL view)
- GST summaries — new
- GSTR-1 working report — **exists (screen)**, `app/api/reports/gstr1`
- GSTR-3B working/reconciliation report — **exists (screen)**, `app/api/reports/gstr3b`
- ITC reconciliation report — **exists (screen)**, `app/api/reports/itc-reconciliation`

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
- **Bank Reconciliation Statement** — the existing tick-off workflow (Phase 5) is screen-only; a
  printable statement (reconciled/unreconciled, as of a date) is the natural PDF/Excel output of
  data that already exists.
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

**Phase 1 — prove the engine (new queries):**
1. Trial Balance (also the natural first PDF to test a signature/approval block against)
2. Customer Ledger
3. Stock Valuation

**Phase 2 — wrap what already exists on screen (no new data model work):**
4. GSTR-1
5. GSTR-3B
6. ITC Reconciliation
7. P&L
8. Balance Sheet
9. Project Costing
10. Work Order Costing

Do not start on §8's "worth adding" list or the rest of §7's catalog until all 10 above are built,
verified against ground rule 2 (screen/PDF/Excel agree exactly, checked with real data, not just
code review), and at least one of #4–#6 has resolved the GST-layout question above.

**After the first 10, in order:**
- The AR/AP/ledger set — Receivables/Payables Aging, Vendor Ledger & Statement, Cash Book, Journal
  Register, Purchase/Sales Register — new queries, but straightforward joins over Phase 5's data.
- Management composites — Monthly Management Report, Company Performance, profitability reports —
  these are aggregates of everything above, so they're naturally last.
- QC's statutory folder (§4) can proceed in parallel once real Form II(1)/III/IIIA samples arrive —
  it's the same engine, just blocked on external input, not sequencing.
