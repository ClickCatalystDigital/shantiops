# Accounting Readiness Register

Internal reference — Shanti Ops accounts scoping. Discovery only; nothing in this document is
built. Scope: STERP Priority 5 (items 39–64), against both legal entities (Shanti Boilers &
Pressure Vessels (P) Ltd, Shanti Techno Fab).

A companion visual version of this document lives at `accounting-readiness.html` in the project
root (open it in a browser). For how to actually build this, phase by phase, see
[ACCOUNTING-IMPLEMENTATION-PLAN.md](ACCOUNTING-IMPLEMENTATION-PLAN.md).

## 1. Two separate problems

"Make Accounting accurate" is really two independent audits, and they fail for different reasons.
Keep them apart when scoping the build.

- **Problem A — the document trail.** Every place the app creates or should create a paper
  record with money on it: quotation, PO, invoice, credit note, payslip. Fails when a document is
  missing entirely, or exists but its numbers were never meant to be ledger-grade.
- **Problem B — the variable inputs.** The rates, slabs, and thresholds those documents multiply
  against: GST%, PF/ESI%, income-tax slabs, professional tax. Fails when the government or market
  moves a number and nothing in the app notices.

Section 4 maps Problem A. Section 5 maps Problem B. They intersect — a Sales Invoice needs both a
document shape *and* a correct live GST rate — but building one doesn't solve the other.

## 2. The existing boundary

Every tax-bearing document already in Shanti Ops was built against one deliberate, explicit
limit — not an oversight.

Quotations, Purchase Orders, and Scope of Supply each store a flat `tax_pct` / `gst_pct` typed
once per document (or once per line, on a purchase order) purely so the PDF can print "GST @
18%." None of them split IGST from CGST/SGST, none look a rate up from an HSN code, and none post
anything to a ledger.

`quotation_items.hsn_code` is annotated in the schema itself: *"stored reference string only,
never a tax-rate lookup."* The same boundary is repeated at `po_items.hsn_code` and in the PDF
generator's own comments.

That boundary was the right call for a document that only ever had to *look* correct on a
printed PDF. It is the wrong shape for a document Accounting has to post from. Crossing it — real
HSN→rate lookups, real IGST/CGST/SGST splits, real ledger postings — is the actual size of the
accounting build, underneath whatever UI gets designed on top.

## 3. Two books, not one

Every accounting document eventually has to say which legal entity it belongs to — separate
GSTIN, separate invoice series, separate books.

- **Shanti Boilers & Pressure Vessels (P) Ltd** — the default entity. Every `company` column in
  the schema defaults here.
- **Shanti Techno Fab** — routed today only by a maker-code convention (`STF-` prefix) on
  statutory documents, not a first-class field most places.

`company` already exists on `projects`, `sale_orders`, `employees`, and `qc_documents`. It does
**not** exist on `quotations`, `purchase_orders`, `po_items`, or any payroll table — so today,
nothing forces a PO or a payslip to declare which entity's books it belongs to. That's a gap
independent of tax logic: even a perfectly GST-accurate PO is useless to Accounting if it can't
say which company issued it.

## 4. Document trail

Every place in the app today that carries, or should carry, a real money figure — and what stands
between it and something Accounting could post from.

| Document | Lives in | Money fields today | Gap for real accounting |
|---|---|---|---|
| **Quotation** | exists — `quotations` | subtotal, tax_pct, tax_amount, total | Flat tax% for the whole document; HSN stored, never priced from. No conversion into an Invoice — it's a dead end once accepted. |
| **Sale Order** | thin — `sale_orders` | so_no, customer_name, description — *no amount fields at all* | Carries no value of its own; the Quotation is the only place the number lives. A Sale Order can't be billed against because it isn't priced. |
| **Sales Invoice** | **built 2026-08-20** — `sales_invoices`/`sales_invoice_items` | invoice_no (real per-company per-FY sequential series), CGST/SGST/IGST split, status, payment_ref | STERP #39, closed. "Convert to Invoice" from an accepted Quotation (Sales workspace). No partial/progressive billing or e-invoice/IRN yet — explicitly deferred (Phase 2 non-goals), not a gap that was missed. |
| **Purchase Order** | exists — `purchase_orders` / `po_items` | discount_pct, gst_pct (flat, default 18), rate/amount per line | Same flat-rate boundary as Quotation. No `company` column — can't say which entity issued it. |
| **Vendor Bill / Purchase Invoice** | **built 2026-08-20** — `vendor_bills`/`vendor_bill_items` | bill_no (supplier's own, free text), CGST/SGST/IGST split, TDS section/rate/amount, payable_amount, status | STERP #41 (Accounts Payable), closed. "Record Bill" against any issued PO (Procurement workspace) — a GRN still records receipt of goods; this is the separate document recording receipt of the supplier's *bill*, the actual AP trigger. |
| **Sales Return / Credit Note** | **built 2026-08-20** — `sales_credit_notes`/`sales_credit_note_items`, linked to `sales_returns` by number | credit_note_no (real per-company per-FY series), line items, amount, reason, status | `sales_returns.credit_note_ref` still free text (untouched, by design — it now points at a real document instead of nothing). No structural link (`credit_note_id` FK) yet, just the number — a small future tightening, not required for the document to exist. |
| **Purchase Return / Debit Note** | thin — `purchase_returns` | qty, debit_note_ref (*free text*) | Direct mirror of Sales Returns — same gap, same free-text reference. |
| **Payroll / Salary Slip** | best-prepared — `salary_slips` | gross_earnings, net_pay, pf_employee/employer, esi_employee/employer, pt_amount, tds_amount | Real computed figures already, and the schema comment on this table literally says *"ACCOUNTING INTEGRATION POINT for a future sync to read."* Nearest thing in the app to accounting-grade today — missing only a `company` column and a journal-entry mapping. |
| **Scope of Supply** | exists — `scope_of_supply` | tax_pct (flat, default 18) | Reference document, not a billing instrument — not a real gap, just not usable as one either. |

## 5. Variable-input registry

The numbers every document above multiplies against — and whether the app has anywhere for them
to live and be updated when the government or market moves them.

| Input | Governs | Current state | Update path today |
|---|---|---|---|
| **PF / ESI rates & ceilings** | Payroll deductions | has a table — `statutory_rates` | Settings → Payroll → Rates form. Single row, admin-editable. |
| **Professional Tax slabs** | Payroll deductions | Telangana only — `professional_tax_slabs` | Same Rates form. Add a state's slabs by hand before hiring there. |
| **Income Tax slabs** | Payroll TDS | new regime, FY2026–27 only — `income_tax_slabs` | Same Rates form, per financial year. Old-regime declarations (HRA, 80C) explicitly out of scope. |
| **GST rate** | Every sales & purchase document | **has a table** — `gst_rates` (built 2026-08-20, Phase 1) | Accounts → GST & TDS Rates, admin-editable, HSN-keyed, effective-dated. **Not yet consumed** by any document — Quotation/PO still default their own flat %, since neither form actually collects HSN today (see Phase 1's deferred retrofit note). Table exists; the wiring is still the gap. |
| **Vendor TDS (194C / 194J…)** | Payments to suppliers | **has a table, now consumed** — `vendor_tds_rates` (Phase 1), deducted on `vendor_bills` (Phase 3, built 2026-08-20) | Same Rates tab, seeded with 194C/194J defaults. Record Bill dialog picks a section, `lib/gst-calc.mjs`'s `tdsAmount()` deducts it into `payable_amount`. Still a flat rate per bill — no per-vendor cumulative threshold tracking (deliberately deferred, real stateful complexity, separable). |
| **Import duty / customs** | Imported material | **doesn't exist** | N/A unless the company actually imports — confirm before scoping. |
| **Forex rates** | Export invoices, foreign vendors | **doesn't exist** | None. STERP #57 (Forex Gain/Loss) already flags this as missing. |

## 6. The pattern already here

Payroll already solved "keep a government number current" once — and it's a real template, not a
fresh design problem.

**What already works** — `statutory_rates` / `professional_tax_slabs` / `income_tax_slabs` are
each a small, seedable table with a known-good default, edited through one admin form
(`components/PayrollWorkspace.jsx`'s Rates tab), versioned by financial year where the number
genuinely changes yearly. A GST-rate master — HSN code, rate, effective-from date — is the same
shape, not a new invention.

**What it doesn't solve** — a table plus a form only answers *where the number lives*. It does not
answer *who notices the government changed it*. Nothing in this app watches the GST portal, the
income-tax department, or an RBI feed — that's a standing process (someone checks, quarterly or on
notification) or a genuinely separate integration, not a side effect of building the table.

## 7. Full Priority 5 coverage map

STERP's own Priority 5 list runs 26 items (39–64) — invoicing through GST returns through
depreciation. Sections 4–5 grouped by function instead of walking that list item by item; this
traces every one of the 26 back, so nothing on the original list is unaccounted for by omission.

| # | STERP item | Shanti Ops dependency | Where |
|---|---|---|---|
| 39 | Sales Invoicing | closed 2026-08-20 | §4 — `sales_invoices` built, see Phase 2 |
| 40 | Accounts Receivable | closed 2026-08-20 | §4 + Phase 5 completion — `customer_receipts` settles it against Sales Invoices, posted to the ledger. Balance due is computed live from receipts summed against the invoice total, not a stored running balance; there's still no dedicated **AR aging** report (30/60/90-day buckets) — that's a real report on top of this, not built |
| 41 | Accounts Payable | closed 2026-08-20 | §4 + Phase 5 completion — `vendor_payments` mirrors it on the purchase side, same caveat (no AP aging report either) |
| 42 | General Ledger | closed 2026-08-20 | Phase 5 — `journal_entries`/`journal_entry_lines`, double-entry, auto-posted off every document type plus Manual Journal Entry (draft → post → immutable → reversal) |
| 43 | Multi-Level Chart of Accounts | closed 2026-08-20 | Phase 5 — per-company chart, 14 seeded accounts, admin-editable. "Multi-level" is structural only (`parent_id` column exists, unused) — every seeded account is currently flat/top-level; a real hierarchy would need actual sub-accounts created, not just the column |
| 44 | Cost Centres | existing asset | `projects` / `work_orders` already are a real cost-centre axis — not a gap, a head start |
| 45 | Budgeting | existing asset | Work Order Costing (SYSTEM.md §5l) already computes planned-vs-actual material & labour — that *is* budget-vs-actual at the project level |
| 46 | Bank Reconciliation | half closed 2026-08-20 | Phase 5 completion — a real but **transaction-level, manual** workflow: every ledger posting against the Bank & Cash control account can be ticked off individually (`journal_entry_lines.reconciled`), with running reconciled/unreconciled balances. This is **not** bank-statement import/matching (no `.csv`/MT940 statement upload, no auto-matching against a bank feed, no `bank_accounts` master with real account numbers) — that heavier version stays exactly where it always was, optional Phase 6/7 work, only worth building once a real bank feed or Tally sync exists |
| 47 | Trial Balance | closed 2026-08-20 | Phase 5 — derived report off `journal_entries` |
| 48 | Profit and Loss | closed 2026-08-20 | Phase 5 — derived report off `journal_entries` (a project-level P&L can still reuse `getProjectCosting()`) |
| 49 | Balance Sheet | closed 2026-08-20 | Phase 5 — derived report off `journal_entries` |
| 50 | Cash Flow / Fund Flow | depends on §4 | Needs Sales Invoice/AR timing to exist first |
| 51 | Credit Notes and Debit Notes | half closed 2026-08-20 | §4 — Credit Notes built (`sales_credit_notes`); Debit Notes still `debit_note_ref` free text only, Phase 3 |
| 52 | Sales Returns linked to accounting | closed 2026-08-20 | §4 — `sales_returns.credit_note_ref` now points at a real `sales_credit_notes` row by number |
| 53 | Purchase Returns linked to accounting | closed 2026-08-20 | §4 — `purchase_returns.debit_note_ref` now points at a real `purchase_debit_notes` row by number |
| 54 | Cheque Printing | gap | Unlike GL/Balance Sheet this is arguably a Shanti Ops document (a payment voucher) — no bank-account master or voucher table exists anywhere |
| 55 | Fixed Assets | adjacent only | `workstations`/`calibration_items` are physical-asset-adjacent; no financial fixed-asset register exists |
| 56 | Depreciation & journal generation | gap — Phase 7 | Shanti Ops now owns this once a Fixed Assets register exists (§Phase 7); not required for Phase 5's core ledger |
| 57 | Forex Gain/Loss | gap | §5 — no forex-rate input anywhere |
| 58 | GSTR-1 (+ GSTR-1A / IFF where applicable) | closed 2026-08-20 | Generated live from Sales Invoice line data at the correct GST rate (B2B + HSN summaries). **No live GST-portal/API connection** — this is a report Shanti Ops generates for someone to file on the portal by hand, not an e-filing integration; that was never in scope (Phase 0's e-invoicing/IRP decision) |
| 59 | GSTR-2 *(STERP's original item name — legacy terminology; GSTR-2 was never notified as a filable return and the GST Council formally dropped it from the compliance cycle)* | closed 2026-08-20 | Not a return Shanti Ops generates. The current recipient-side workflow is GSTR-2B (the GST portal's static monthly ITC statement) + IMS (Invoice Management System, where the recipient accepts/rejects/leaves pending each vendor invoice — un-actioned lines are deemed accepted). Shanti Ops' job is **ITC reconciliation**: match its own Vendor Bills against GSTR-2B/IMS data (intake is Excel/CSV upload of the portal's own download, plus manual entry for exceptions — **no live GST-portal/API connection**, confirmed decision) and feed the resulting eligible ITC into GSTR-3B. Excluded/rejected ITC is a flat amount, **not run through Rule 42/43 proportional reversal** — that real additional complexity remains unimplemented, out of scope unless a real need for exempt-supply proportioning surfaces. Shanti Ops' Vendor Bill ledger stays the accounting source of truth — GSTR-2B/IMS is an external compliance input to reconcile against, not a purchase register to import and treat as authoritative |
| 60 | GSTR-3B monthly return | closed 2026-08-20 | Nets GSTR-1's outward tax against ITC reconciliation's eligible ITC (row 59). (GSTR-3, the original full return GSTR-3B was meant to replace, was also suspended and never revived — GSTR-3B is the actual current monthly summary return.) Same no-live-API caveat as row 58 |
| 61 | GSTR7 / TDS return | gap | §5 — vendor TDS has a table and is deducted on `vendor_bills` (Phase 3), and the ledger/reporting infrastructure it would need now exists (Phase 5) — but a GSTR-7 generator itself (the TDS return document) was never built. Still open |
| 62 | PF Registers | depends on §4 | Generated from `salary_slips`, already the best-prepared table — `company` routes via `employees.company` (Phase 0), no new data needed. Register generation itself is still Phase 5's job |
| 63 | ESI Registers | depends on §4 | Same as PF Registers |
| 64 | Salary Auto-JV to Accounts | closed 2026-08-20 (wiring) | `salary_slips.payroll_export_status` built (Phase 4) — the not_exported/exported/reconciled flag Phase 5's ledger posting will consume. Actual journal-entry generation is Phase 5, not this row |

## 8. Where this leaves you

**Decided 2026-08-20** (see [ACCOUNTING-IMPLEMENTATION-PLAN.md](ACCOUNTING-IMPLEMENTATION-PLAN.md)):
Shanti Ops is the system of record for the full Accounts workflow, including ledger/GL/GST/
financial statements — not just the document trail. Tally is an optional sync target, not the
book of record. That resolves the first open question below; the second is still open:

- ~~**Document trail (§4):** which of the missing entities... actually need to live inside Shanti
  Ops~~ — resolved: all of them do, along with the ledger itself.
- **Variable inputs (§5):** whether a GST-rate master gets built the same way Payroll's rates
  were — a table plus a Settings form, someone still checking manually — or whether it's worth a
  real external rate feed once volume justifies it.

## 9. Known limitations (2026-08-20, after Phase 5 completion)

Phase 5 — General Ledger, Manual Journal Entry, inventory consumption costing, AR/AP settlement,
bank reconciliation, and GST compliance — is fully built (§7 rows 39–43, 47–49, 58–60; SYSTEM.md
§5v/§5w). These are the deliberate boundaries of that work, not oversights:

- **Inventory lines without a traceable catalog item aren't costed.** Costing only works when a
  Vendor Bill line's `bom_item_id` resolves through `bom_items.item_id` to a tracked
  `inventory_items` row. A line whose item was never picked from the catalog search (the common
  case today per the real client data — see §2's own note on `item_code` sparsity) is received and
  issued with no cost captured, not a guessed one.
- **Weighted-average is the current — and only — inventory valuation method.** Confirmed by
  inspection that no costing method (FIFO or otherwise) existed anywhere in the app before Phase 5;
  weighted-average was adopted as the one method, not a second parallel system alongside something
  that already existed.
- **Bank reconciliation is transaction-level, not bank-statement import/matching.** Accounts can
  tick individual ledger postings against the Bank & Cash control account off by hand. There is no
  `.csv`/MT940 statement upload, no auto-matching against a real bank feed, and no `bank_accounts`
  master with actual account numbers — that heavier version is still Phase 6/7 territory (STERP
  item 54, Cheque Printing's own prerequisite), unchanged by this pass.
- **GST has no live portal integration.** Every GST report (GSTR-1/1A/IFF, GSTR-2B/IMS reconciliation,
  GSTR-3B) is generated by Shanti Ops for a human to act on via the actual GST portal — no e-filing
  API, no live GSTR-2B pull (Excel/CSV upload only). E-invoicing/IRN/QR/IRP integration remains the
  Phase 0 decision it always was: not required at the current turnover bracket, not built.
- **Rule 42/43 proportional ITC reversal is unimplemented.** ITC reconciliation excludes
  not-available/rejected lines as a flat amount; it does not compute a proportional reversal for
  exempt-supply use. Real additional complexity, out of scope unless a genuine need surfaces.
- **Tally interoperability remains future work.** Unchanged since the 2026-08-20 architecture
  decision: Shanti Ops owns the full ledger, Tally is an optional sync target (Phase 6, genuinely
  optional, untouched by Phase 5).

---

Everything above is read directly off the current schema and code comments, not inferred — every
"missing" and "flat-rate only" claim in this register can be re-checked against `lib/db.js` and
the STERP.md Priority 5 list at any time.

Compiled from `lib/db.js`, `STERP.md`, `SYSTEM.md` — 2026-08-20.

**Source note (GST terminology, 2026-08-20 pass):** §7 rows 58–60 were rewritten against the
GST Portal's current outward-supply and ITC workflows (GSTR-1 / GSTR-1A / IFF for outward
supplies; GSTR-2B + IMS for recipient-side ITC; GSTR-3B as the operative monthly return) — not
off the original STERP checklist's older GSTR-1/2/3 model or any legacy ERP-implementation
checklist. STERP's own item 59 label ("GSTR2") is left in row 59's first column only because
that's STERP's item name, not a description of what Shanti Ops actually builds — see that row's
own note.

## 8. Real-world finding — a real order where the source document disagrees with the app's own
## automatic intra/inter-state GST split (2026-09-04)

Found while wiring up a real Sale Order (SO-22, project SB-1109-01-50, customer HKM CHARITABLE
FOUNDATION) from the client's own Order Acknowledgement / Scope of Supply PDF, not a hypothetical:

- Both parties are registered in the **same state** — Shanti Boilers (GSTIN `36AAECS7382N1ZN`,
  Telangana) and HKM CHARITABLE FOUNDATION (state code 36, Telangana), confirmed directly against
  `company_settings` and the real `customers` row.
- `lib/gst-calc.mjs`'s `gstSplit()` (§3, already built for real Sales Invoice posting) would
  therefore compute this as an **intra-state** sale — CGST + SGST.
- The client's own source document explicitly states **"ADD: IGST @ 18%"** — inter-state
  treatment.

This is a real, live discrepancy, not a bug in `gstSplit()` — the function is doing exactly what
it was built to do given the two parties' registered addresses. Two real possibilities, both
legitimate under GST law and neither decidable from inside this app: (a) the actual place of
supply differs from both parties' registered address (common for boiler installation/site-delivery
contracts, where place of supply can follow the delivery/installation site rather than the
registered billing address), or (b) the source document's IGST line is simply a template default
that was never corrected for this specific order.

**Not resolved here — flagged for whoever handles this order's real GST filing to confirm before
any invoice is issued against SO-22.** If place-of-supply genuinely differs from registered
address for this kind of contract, `gstSplit()`'s "same state = intra-state" rule (accurate for
the common case) doesn't hold, and either the invoicing flow needs an explicit "place of supply"
override field (not built — `gstSplit()` currently has no way to express this), or this specific
invoice's split needs to be entered manually rather than trusting the automatic calculation. Worth
treating as a signal to eventually check whether place-of-supply commonly differs from registered
address for Shanti's real installation-heavy contracts, not just a one-off data-entry question.
