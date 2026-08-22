# Accounting Implementation Plan

How to actually build the Accounts department, phase by phase. Read
[ACCOUNTING-READINESS.md](ACCOUNTING-READINESS.md) first — this plan is the "how" to that
document's "what's missing." Each phase below is sized to be a real, coherent chunk of work (not
a single table), ordered by dependency and payoff, not by STERP's original numbering.

**Architecture, settled going in (revised 2026-08-20):** Shanti Ops is the system of record for
the full Accounts workflow — ledger, chart of accounts, journal postings, trial balance, P&L,
balance sheet, and GST return generation all live here. Tally is an **optional** downstream/
upstream sync target, not the owner of the books — an entity that can exchange updates with
Shanti Ops, the same way `erp_snapshot` (`lib/db.js`) already receives numbers from outside. This
reverses the original "don't cross the ledger line" assumption below Phase 4; Phases 0–4 are
unaffected (they were always groundwork Shanti Ops needed regardless), but everything downstream
of Phase 4 — General Ledger, Trial Balance, P&L, Balance Sheet, Depreciation, GST compliance
(GSTR-1/1A/IFF outward, GSTR-2B/IMS-based ITC reconciliation, GSTR-3B) — is now
in-scope Shanti Ops work, not "pure ERPNext/Tally output" as originally scoped. Phase 5 is
retitled and rescoped below to match. e-invoicing (IRN/QR) confirmed not required for the current
turnover bracket — deferred, no speculative fields. Both entities' real GSTIN/PAN/registered
address were found already in the codebase (`lib/qc-doc-pdf.js`'s `COMPANY_PROFILES`, already
used on QC document PDFs) and backfilled into `company_settings` — see Phase 0 decision 2.

## Ground rules for every phase (read once, apply throughout)

- **Mirror, don't invent.** This codebase has a strong "reuse the existing shape" culture and
  every new accounting piece has a real precedent already in the repo:
  - A whole-row, department-owned entity with its own admin panel → `qc_records` +
    `components/QcPanel.jsx` (SYSTEM.md §5b).
  - An admin-editable rate/slab master with a Settings-style form → `statutory_rates` /
    `professional_tax_slabs` / `income_tax_slabs` + `components/PayrollWorkspace.jsx`'s
    `RatesForm` (this is THE template for the GST master and the TDS master — don't design a new
    shape).
  - A return/note document linked back to its parent → `sales_returns` / `purchase_returns`
    (inspection_outcome, stock_action, `*_note_ref`) — the Credit Note / Debit Note phases extend
    this, they don't replace it.
  - A real, continuing document-number sequence → the `counters` table + `po_no` seeding pattern
    (`lib/db.js`).
- **Every new table**: `created_by`/`created_at` columns, no `NOT NULL` on anything optional,
  indexed on its main foreign key. Follow `lib/db.js`'s existing `addColumn`/`CREATE TABLE IF NOT
  EXISTS` idioms — never a destructive migration.
- **Every new department action** goes into `ACTION_CATALOG` (`lib/action-permissions.js`) under
  a new `Accounts:` block, gated with `requireAction`. Default open (no seeded Head-gate row)
  unless there's a real reason — same rule the QC inspection round just followed.
- **Any real calculation logic** (tax split, TDS threshold accumulation, invoice-number rollover
  at financial-year boundary) gets pulled into a dependency-free `lib/*.mjs` file with a matching
  `lib/*-selfcheck.mjs` — same precedent as `lib/bom-structure.mjs` and `lib/qc-inspections.mjs`.
  Trivial CRUD needs no test.
- **Ledger line moved, not removed.** Phases 0–4 still don't post journal entries or compute
  balances — those phases are about correct documents and correct tax, and stay exactly as
  scoped. Ledger posting, trial balance, P&L, and balance sheet are now genuinely Shanti Ops'
  job, but they're Phase 6+ work (see the rescoped Phase 5/6 below) — don't pull ledger logic
  forward into Phases 0–4 just because it's now in-scope eventually.
- **Live-verify each phase** the same way the QC round did: direct API GET/POST checks against
  the real dev DB as a purpose-made test user, not exhaustive browser clicking. Clean up test rows
  after.

---

## Phase 0 — Decisions & Foundation (small, but blocks everything else)

**Priority: must go first.** Nothing downstream can be built correctly without these settled.

**Decisions — answered 2026-08-20:**
1. ~~Tally or ERPNext~~ **Neither owns the books.** Shanti Ops is the system of record for the
   full Accounts workflow (ledger, GL, journals, trial balance, P&L, balance sheet, GST). Tally is
   an optional sync target, not the owner — see the revised architecture note above and the
   rescoped Phase 5/6 below.
2. Both entities' real GSTIN/PAN/registered address — **found 2026-08-20, not actually missing.**
   `lib/qc-doc-pdf.js`'s `COMPANY_PROFILES` already carries both entities' real GSTIN and address
   (used on QC document PDFs already issued to customers) — nobody had checked before answering
   "don't have it handy" at Phase 0. `company_settings` is now backfilled with the real GSTIN,
   PAN (derived from the GSTIN's own embedded PAN), and address for both entities — not
   placeholders. Fresh-DB seed updated to match, so this stays true for any new environment too.
3. e-invoicing (IRN/QR) — **not required right now.** Deferred; no speculative fields in Phase 2.

**Build:**
- **`Accounts` as a real department.** It doesn't exist yet — `DEPARTMENTS` in `lib/milestones.js`
  is `['Design', 'Engineering', 'Procurement', 'Stores', 'Production', 'QC', 'Dispatch',
  'Installation', 'Sales', 'Marketing', 'HR']`, no `Accounts`. Adding it is small but touches
  several places: the `DEPARTMENTS` array itself, a Nav entry, `HEAD_USERS` seeding for a demo
  `accounts_head` account (and don't forget the `department_roles` backfill this session's QC
  round found — every `<dept>_head` seed must actually stamp `department_roles`, checked live, not
  assumed). No milestones need to move to it yet; that stays department-agnostic until a phase
  actually needs a milestone.
- **`company_settings` table** — one row per legal entity: legal name, GSTIN, PAN, registered
  address, state, state_code, default invoice-series prefix. Two seeded rows (Shanti Boilers,
  Shanti Techno Fab) using Phase 0's confirmed real values, not placeholders.
- **Backfill `company` onto every table that will carry money and doesn't have it yet**:
  `quotations`, `purchase_orders`, `po_items` (inherit from parent PO), and the payroll tables
  (`salary_slips` via its linked employee's `company`, already present on `employees`). This is
  the fix for the single gap the readiness register called "independent of tax logic."

**Non-goals for this phase:** no GST math yet, no new documents yet. This phase is purely "every
future accounting document can now say who it belongs to."

---

## Phase 1 — GST & TDS Rate Masters

**Status: built 2026-08-20** — `gst_rates` and `vendor_tds_rates` tables, Settings UI (Accounts
workspace's "GST & TDS Rates" tab), live-verified. The retrofit below was investigated and
**deferred** — see its note.

**Priority: second.** This is the single largest variable-input gap on the readiness register,
and — unlike every later phase — it can start paying off immediately by retrofitting into the
*existing* Quotation/PO/Scope-of-Supply flat `tax_pct` fields, before Sales Invoice even exists.

**Build:**
- **`gst_rates`** — `hsn_code`, `description`, `rate_pct`, `effective_from`, `effective_to`
  (nullable = still current). Same shape as `income_tax_slabs`' financial-year versioning, just
  keyed by HSN instead of income band.
- **`vendor_tds_rates`** — `section` (194C/194J/…), `rate_pct`, `threshold_amount`,
  `effective_from`, `effective_to`. A rate table only — **do not** build per-vendor cumulative
  threshold tracking in this phase (that's a stateful running calculation, real complexity, and it
  only matters once Vendor Bills exist to deduct against — see Phase 3's non-goals).
- **Settings UI** — extend the existing Rates-form pattern (`PayrollWorkspace.jsx`'s `RatesForm`)
  with two more tabs/sections, not a new UI paradigm. `Accounts` department gate, not Payroll's.
- **Retrofit** (re-scoped, was called "small" — it isn't): let Quotation/PO line items look up
  `tax_pct` from `gst_rates` by HSN instead of defaulting to a hand-typed 18%, while still
  allowing manual override. **Investigated 2026-08-20 and deferred**: `hsn_code` exists on
  `quotation_items`/`po_items` in the schema, but neither `SalesWorkspace.jsx`'s quotation form nor
  the PO item editor (`BomPanel.jsx`/`BomTable.jsx`) actually collects it anywhere today — the
  Quotation form takes one flat GST% for the whole document, no per-line HSN field exists at all.
  A real retrofit means adding HSN input UI to both forms first, then wiring the lookup — that's
  new UI surface on two workspaces, not the one-line change the original plan assumed. Do this as
  its own small phase once a real need surfaces, not bundled into "Phase 1."

**Non-goals:** no CGST/SGST/IGST split logic yet (that needs to know both parties' state codes and
the transaction type — do it once, correctly, in Phase 2 where it's actually consumed, not twice).

---

## Phase 2 — Sales Invoice + Credit Note

**Status: built 2026-08-20** — `sales_invoices`/`sales_invoice_items`/`sales_credit_notes`/
`sales_credit_note_items`, tax-split calc (`lib/gst-calc.mjs` + selfcheck), "Convert to Invoice"
and "Credit Note" actions on the Sales workspace, live-verified end to end.

**Priority: third — the biggest single document gap, and the one everything else (AR, Cash Flow,
GSTR-1) is downstream of.**

**Build:**
- **`sales_invoices`** / **`sales_invoice_items`** — mirrors `quotations`/`quotation_items`'
  shape (it's the natural template: same subtotal/tax/total columns, same HSN-per-line), plus what
  a quotation never needed: `company` (Phase 0), `invoice_no` (real sequential series, scoped
  per-company via the `counters` pattern — key it `invoice_no:<company>:<financial_year>` so each
  entity's series resets correctly at FY boundary, matching real GST sequential-numbering rules),
  `sale_order_id`/`project_id` link, `invoice_date`, `due_date`, `status`
  (draft/issued/paid/cancelled), `payment_ref`. Tax split (CGST+SGST vs IGST) computed from the
  customer's `state_code` vs the issuing company's `state_code` (Phase 0/1 data), using the
  `gst_rates` lookup from Phase 1 — this is the one real piece of calculation logic in this phase,
  so it's the one that gets a `lib/*.mjs` + selfcheck.
- **`sales_credit_notes`** — replaces `sales_returns.credit_note_ref`'s free text with a real
  linked document: `sales_invoice_id`, line items, amount, reason, `status`. `sales_returns`
  itself is untouched — this phase adds the document a return can now point at, it doesn't
  redesign the return flow that already works.
- **UI**: a Sales Invoice tab, most naturally on the existing Sales workspace next to Quotations
  (same customer/project context) — "Convert to Invoice" action from an accepted Quotation, not a
  from-scratch form as the only path in.

**Non-goals:** no e-invoice/IRN integration unless Phase 0 confirmed it's actually required now.
No partial/installment billing schedule unless a real customer need surfaces — YAGNI, and it's a
meaningfully bigger feature than a first invoice needs.

---

## Phase 3 — Vendor Bill + Debit Note

**Status: built 2026-08-20** — `vendor_bills`/`vendor_bill_items`/`purchase_debit_notes`/
`purchase_debit_note_items`, "Record Bill" on any issued PO and "Debit Note" on any bill
(Procurement workspace), Phase 1's `vendor_tds_rates` now actually consumed via
`lib/gst-calc.mjs`'s `tdsAmount()`. Live-verified end to end, including the TDS deduction path.

**Priority: fourth — direct mirror of Phase 2 on the purchase side.**

**Build:**
- **`vendor_bills`** / **`vendor_bill_items`** — same shape as Phase 2's Sales Invoice, purchase
  direction: `po_id` link (the PO already exists and has real line items to bill against),
  `bill_no` (the *supplier's* number, free text — you don't control their series), `company`,
  `bill_date`, `due_date`, `status`, and now Phase 1's `vendor_tds_rates` actually gets consumed:
  a bill can have a TDS line deducted from the payable amount using the applicable section's rate.
- **`purchase_debit_notes`** — mirrors Phase 2's Credit Note, replacing
  `purchase_returns.debit_note_ref`'s free text the same way.
- **UI**: extends `ProcurementWorkspace.jsx`, most naturally right where the PO's status already
  tracks Received — "Record Bill" once goods are in, same relationship a GRN already has to a PO.

**Non-goals:** still no per-vendor cumulative TDS threshold tracking across the financial year —
apply the flat section rate per bill for now; the running-threshold refinement is real but
separable, and doesn't block getting a correct-enough bill out the door.

---

## Phase 4 — Payroll → Accounting Export

**Status: built 2026-08-20** — `salary_slips.payroll_export_status`
(`not_exported`/`exported`/`reconciled`), toggled from the existing Payroll workspace slip detail
sheet. `company` already routed via `employees.company` (Phase 0) — nothing to backfill. Live-
verified.

**Priority: fifth — the cheapest phase on this whole plan.** `salary_slips` is already the
best-prepared table in the app for this; its schema comment already says "ACCOUNTING INTEGRATION
POINT for a future sync to read." This phase is mostly wiring, not new data.

**Build:**
- Confirm `salary_slips` carries `company` (via its employee, Phase 0) so payroll can route to the
  correct entity's books.
- A `payroll_export_status` column (or small linked table, whichever is a smaller diff once you're
  looking at the real schema) — not_exported / exported / reconciled — the same status vocabulary
  Phase 5 will reuse for every other document type, introduced here first since Payroll is the
  simplest case to prove it on.
- No new financial computation — the PF/ESI/PT/TDS amounts already exist and are already correct
  against Phase 1's... actually, payroll's statutory rates were already solved before this plan
  started (`statutory_rates`/`professional_tax_slabs`/`income_tax_slabs`); this phase does not
  touch that.

---

## Phase 5 — General Ledger & Financial Statements (Shanti Ops owns this now)

**Priority: sixth.** This phase did not exist in the original plan — it's the direct consequence
of the 2026-08-20 architecture decision that Shanti Ops, not Tally/ERPNext, owns the books. It
consumes Phases 0–4's documents (Sales Invoice, Vendor Bill, Credit/Debit Notes, Payroll) and is
the first phase where "post a journal entry" and "compute a balance" are actually in scope.

**Build:**
- **Chart of Accounts** — per-`company` (Phase 0), standard heads (Assets/Liabilities/Income/
  Expense/Equity), admin-editable, seeded with a sane default set rather than built empty.
- **`journal_entries`** / **`journal_entry_lines`** — double-entry postings, one row per
  debit/credit line, linked back to its source document (`sales_invoices`, `vendor_bills`,
  `sales_credit_notes`, `purchase_debit_notes`, `salary_slips`) via a `source_type`/`source_id`
  pair. Auto-post on document issue (e.g. issuing a Sales Invoice posts AR debit / Revenue
  credit), not a separate manual step for the common case.
- **Trial Balance / P&L / Balance Sheet** — derived reports off `journal_entries`, per company,
  per date range. Read-only rollups, no new data.
- **GST compliance (current model, not the old GSTR-1/2/3 model)** — outward and inward sides are
  genuinely different workflows now, not a symmetric pair of returns:

  ```
  SALES / SALES INVOICES                    PURCHASES / VENDOR BILLS
         ↓                                          ↓
    Output GST                                  Input GST
         ↓                                          ↓
  GSTR-1 / GSTR-1A                          GSTR-2B + IMS
  (IFF instead of GSTR-1 for a                     ↓
   QRMP-registered company's                ITC reconciliation
   first two months of a quarter)                  ↓
         ↓                             Eligible ITC / ITC reversals
         └───────────────→  GSTR-3B  ←───────────────┘
                        (net liability)
  ```

  - **Outward (GSTR-1 / GSTR-1A / IFF)** — generated from Sales Invoice line data at the GST
    rates from Phase 1. GSTR-1A (amend an already-filed GSTR-1 before GSTR-3B) and IFF (the
    QRMP scheme's monthly Invoice Furnishing Facility, an alternative to GSTR-1 in a quarter's
    first two months) are the same underlying Sales Invoice data, filed on a different cadence —
    not a separate document type to build.
  - **Inward (GSTR-2B + IMS, replacing the old "GSTR-2" idea)** — GSTR-2 was never notified as a
    filable return and isn't part of the current compliance cycle; do not build toward it. The
    government's own recipient-side workflow today is GSTR-2B (a static monthly ITC statement
    auto-drafted from suppliers' filings) plus IMS (Invoice Management System, where each inward
    invoice is accepted / rejected / left pending — pending lines are deemed accepted before the
    GSTR-3B due date if untouched). Shanti Ops' job here is **ITC reconciliation**: match its own
    Vendor Bills against GSTR-2B/IMS data (however that data gets in — manual entry, a future
    portal API, or a file import; not decided yet, don't build a speculative import format) and
    surface the eligible ITC and any ITC reversals that then feed GSTR-3B. Shanti Ops' own
    Vendor Bill ledger stays the accounting source of truth throughout — GSTR-2B/IMS is an
    external compliance/reconciliation input, never a replacement purchase register to import
    and trust blindly.
  - **GSTR-3B** — the actual operative monthly return (GSTR-3, the full return it was meant to
    replace, was suspended and never revived), net of the outward and inward sides above.
  - **Not in this phase's scope**: e-invoicing/IRN/QR/IRP integration. Phase 0 already decided
    this isn't required at the current turnover bracket (see that phase's decision 3) — nothing
    here changes that. Keep the Sales Invoice document model extensible for a future IRP
    integration (e.g. don't design fields that would conflict with an IRN/QR being added later),
    but don't build toward it now.

**Non-goals:** no multi-currency ledger, no budget-vs-actual variance reporting beyond what Work
Order Costing already gives at the project level, no automated period-close/lock — build those
only once real month-end use surfaces the need.

---

## Phase 6 — Optional Tally Sync

**Priority: seventh — genuinely optional, build only if/when Tally interop is actually needed**
day to day (e.g. an external accountant who works in Tally). Shanti Ops' books are complete and
correct without this phase; it exists purely for interoperability.

**Build (outbound, do this half first if built at all):**
- One `<doctype>_sync_status` field (not_synced/synced/reconciled) on Sales Invoice, Vendor Bill,
  Credit Note, Debit Note, and Phase 4's payroll rows.
- An export action producing the XML shape Tally's ODBC/XML gateway expects.
- A single **Accounts → Sync/Reconciliation** view listing what's pending, synced, and reconciled.

**Build (inbound, only once outbound is proven and only for what's actually needed):**
- A minimal **Import Center** for *master data only* — Customer, Supplier, GST/HSN reference —
  not transactional data. Shanti Ops owns the ledger now, so importing Tally's own journal data
  back in is explicitly out of scope.
- **Do not** design the exact import file format speculatively. Get one real Tally export sample
  and build the parser against that real file.

---

## Phase 7 — Nice / Later (build opportunistically, not on this critical path)

**Update (2026-08-22): Fixed Assets shipped in §5aa/§5z, no longer "later"** — real financial asset
ledger, depreciation (SLM/WDV), and disposal all exist. What's still genuinely missing from that
area is a **Fixed Asset Register + Depreciation Schedule as proper Report Engine entries** (right
now `fixed_assets`/`depreciation_runs` only have a workspace tab, no catalog report/PDF) — folded
into Phase 8 below rather than left here.

No fixed order among the remaining two; pull whichever one a real, current need justifies. Neither
blocks Phases 0–6 or is blocked by them.

- **Cheque Printing** — needs a `bank_accounts` table (account, IFSC, bank name, per-company) and
  a payment-voucher entity first; the printing itself is a PDF template, same pattern as every
  other PDF in this app (`lib/*-pdf.js`).
- **Forex Gain/Loss** — only relevant if there are actual export invoices or foreign-currency
  vendor bills; confirm real need before building a currency-rate table nobody uses.

---

## V1 completeness roadmap (2026-08-22) — closing the accountant's daily-use loop

A second AI scored the current build ~7/10 toward "a real Indian manufacturing company could run
its Accounts department on this without needing Tally for core bookkeeping," and proposed stopping
V1 at ~8/10. Verified against what's actually built (SYSTEM.md §5q–§5aa, `lib/reports/catalog.js`)
rather than taken at face value — the score's direction is right, but not all of its "gaps" are
real gaps. Two of the three it named are deliberate, already-made scope decisions, not
incompleteness:

- **"GST return filing automation" / "live GST portal API"** — scored low, but this was a
  deliberate standing decision (§5v/§7 above): GSTR-2B comes in via manual upload same as the GST
  portal's own export flow, filing stays manual. Mature products don't self-serve this either —
  Tally's own "connected GST filing" goes through a GSP, same as this app would if it ever needed
  it (see Phase 9). Not a V1 gap to close by building more; a boundary already correctly placed.
- **"GST reconciliation / 2B workflow"** — GSTR-2B upload + IMS accept/reject + ITC reconciliation
  against Vendor Bills is already built and live-verified (§5v/§5w). Scored low against a fuller
  automation this app deliberately doesn't attempt, not because the workflow is missing.

Two gaps are real and worth closing for V1:

### Phase 8 — Bank reconciliation: statement import + matching

**Status: built 2026-08-22, code-reviewed + smoke-tested — see SYSTEM.md §5ab.** Matcher
(`lib/bank-match.mjs`), parser (`lib/bank-statement-import.mjs`), import + quick-JE routes, and UI
all built. **Known gap, by explicit user decision**: not yet exercised against a real bank
statement file or the real dev DB — the parser's header-alias map is pinned only to a synthetic
CSV, not a real export. Live-verify whenever a real statement file becomes available; not treated
as a blocker for the rest of the roadmap.

**No paid service needed for this.** The instinct to reach for a bank API is the wrong shape of
fix — even Tally's own reconciliation is file-import-based (a statement the user downloads from
netbanking, in CSV/OFX/MT940), not a live bank API; live feeds are an enterprise-tier feature even
there. The free, standard-practice path: parse a downloaded statement file, match rows against
already-recorded `journal_entry_lines` on the Bank & Cash account (by date + amount, ±few days
tolerance for float), surface unmatched rows on both sides for manual tie-off. This *extends* the
existing manual tick-off (§5w) rather than replacing it — auto-match confidently, still allow
manual reconciliation for whatever doesn't match.

**Build**: a statement-row parser (start with one bank's real CSV export — do not design the
column-mapping speculatively, same rule Phase 6 already uses for Tally imports); a matching
function (pure, testable, own selfcheck) scoring candidate matches by date-proximity + exact
amount; an "Import Statement" action in the existing Bank Reconciliation tab showing matched/
unmatched, with one-click confirm on high-confidence matches and manual pairing for the rest.

**Prompt to hand a fresh chat for Phase 8:**

```
Read SYSTEM.md fully first (§5w for the existing manual Bank Reconciliation tab, §5z/§5aa for the
most recent Accounts work), then ACCOUNTING-IMPLEMENTATION-PLAN.md's Phase 8 section. Don't
re-derive anything already built — company_settings, chart_of_accounts, journal_entries/
journal_entry_lines (with a `reconciled`/`reconciled_at` pair already on journal_entry_lines per
§5w), and the existing Bank Reconciliation tab in AccountsWorkspace.jsx all already exist.

Build statement import + auto-match on top of that, not a replacement for the manual tick-off.
Before writing any parser, get one real bank statement export (CSV, from whichever bank the user
actually uses) — do not design the column mapping from assumptions, same rule this doc's Phase 6
already uses for Tally imports. Ask the user for that file before starting if it isn't in the
repo already.

Real design questions to resolve with the user first, not assumed:
1. Which bank(s) — one format to start, or does a real multi-bank need exist now?
2. Match tolerance — same-day exact-amount only, or a few days' float tolerance? What should happen
   to a statement row that matches no ledger line (a bank charge/interest never recorded)?
3. Does a "high-confidence match" auto-reconcile, or does everything still need a human click even
   when the match is obviously correct?

This is real financial reconciliation logic — leave a runnable selfcheck for the matching function
(pure, no DB), same as `lib/depreciation.mjs`/`lib/ledger.mjs`'s pattern this session. Live-verify
against the real dev DB (remote Turso — see the dev-server-uses-remote-turso note) using the user's
real statement file, not fabricated bank rows.
```

### Phase 9 — Report depth: Fixed Asset Register, Depreciation Schedule, Cash Flow Statement

**Status: all three built AND live-verified against the real dev DB, 2026-08-22 — see SYSTEM.md
§5ac.** Cash Flow Statement's design questions were resolved with the user before writing code:
indirect method; categorization by account type + a Fixed-Assets/Accumulated-Depreciation code
exception, overridable per account via a new `chart_of_accounts.cash_flow_category` column — not
per-transaction tagging. Live verification (real fixed-asset purchase/depreciation/disposal cycle,
real ledger data) confirmed the compliance-critical invariant — computed Cash Flow ties to the
actual Bank & Cash movement to the rupee — held exactly across every scenario tested, including
the account-level override and its revert. One cosmetic PDF bug (a wrapping column) found and
fixed while verifying. An on-screen browser gap was also found (no `SCREEN`-map card for any of the
three, plus the pre-existing TDS Deduction Register) and closed the same day per the user's "no
gaps" instruction — see SYSTEM.md §5ad. All four now render real data on-screen, browser-verified.

**No paid service needed for this either** — pure computation over data already captured.
- **Fixed Asset Register** + **Depreciation Schedule** — wire `fixed_assets`/`depreciation_runs`
  into `lib/reports/catalog.js` like every other report (one `compute()`, screen/JSON/PDF share
  it, ground rule already established). Asset Register: one row per asset, cost/method/accumulated
  dep/book value/status. Depreciation Schedule: one row per asset per period run, tying back to
  `depreciation_run_lines`.
- **Cash Flow Statement** — genuinely not built (Cash/Bank Book is a ledger, not operating/
  investing/financing categorized cash flow). Needs a real design decision first (direct vs.
  indirect method; how to categorize each `journal_entry_lines` row by activity) — resolve that
  with a human before writing code, same as Phase 5's account-mapping questions were resolved
  up front rather than guessed.

### Phase 10 — Government-connected compliance (e-invoice, e-way bill, TDS 26Q workflow)

**Trigger check (2026-08-22): none fired.** Asked the user directly, per this phase's own rule
(don't build speculatively) — turnover hasn't crossed the e-invoicing threshold, dispatch volume
isn't near the e-way-bill threshold, and there are no exempt supplies yet (so Rule 42/43 isn't
relevant). **Status: still correctly deferred, nothing built.** Re-ask this question next time this
phase comes up rather than assuming last check's answer still holds.

**Explicitly deferred, build only when a real trigger hits — do not build speculatively:**
- **E-invoicing/IRN** — only if turnover crosses the mandatory threshold (confirm with your CA
  first). **Paid service genuinely needed then**: production API access requires GSTIN-based
  registration as an Intermediary/API integrator through one of the government-sanctioned IRPs
  (ClearTax/Cygnet/IRIS-style commercial IRPs, or NIC's own portal) — not casual free self-service,
  confirmed via direct research (§5aa). **Correction (2026-08-22, second research pass)**: at least
  one IRP (IRIS) publishes onboarding APIs specifically for solution providers/ERP vendors — GSTIN
  OTP verification, setting IRP credentials, granting API access per client GSTIN — so a future
  Shanti Ops connector could plausibly drive customer onboarding itself rather than only wrapping a
  GSP's own UI. Doesn't change the trigger condition (still gated on turnover), only the
  practicality once that trigger fires. Architecture readiness (§5z, not yet acted on): keep the
  Sales Invoice model extendable with an IRN/signed-QR slot later, don't build something that has
  to be redesigned if e-invoicing ever gets switched on. Credentials/connection state, if ever
  built, belong per-company in Shanti Ops (`company_settings`-adjacent) — never in
  statutory-rates-hub, which only distributes identical-for-everyone rate data and holds no
  per-company secrets or transactional state.
- **E-way bill generation** — only if dispatching goods above the state threshold (usually
  ₹50,000/consignment). **Paid service genuinely needed then**: production API access requires GSP
  registration, same story as e-invoicing. **Correction (2026-08-22)**: eligibility for direct
  (non-GSP) API access is volume-based — roughly 1,000 e-way bills/day or 10,000 transactions/month
  per GSTIN, per the EWB portal's own prerequisites — not restricted by industry/business type as
  previously assumed. Still not a real trigger today (nothing indicates dispatch volume is near
  that), so still deferred; noted so it isn't mis-scoped as "industry-ineligible" later. Same
  per-company placement as e-invoicing above if ever built — not statutory-rates-hub.
- **TDS 26Q e-filing** — the TDS Deduction Register (§5z) already gives the data; actual TRACES-
  format filing has no clean API for a self-service integration at any price — stays a CA/return-
  prep-software task regardless of budget.
- **TCS (206C(1H))** — needs the same cumulative per-customer threshold tracking vendor TDS
  deliberately doesn't have yet; building it without that tracking would be wrong, not incomplete.
- **Rule 42/43 proportional ITC reversal** — real accounting nuance, only matters with exempt
  supplies.

### On the statutory-rates-hub and paid rate-data feeds

Already solved without a paid service (`statutory-rates-hub`, SYSTEM.md §5y): a central,
human-verified rate registry your team updates after reading real notifications (Budget, GST
Council meetings), distributed to every tenant install automatically. No reliable free *or* paid
API exists for "the current correct GST/TDS rate" as a live feed — a paid compliance-data
subscription (e.g. ClearTax's GST rate API) could reduce the manual-checking labor if that
tradeoff is ever worth it, but it's optional, not a gap. Nothing here needs it to function
correctly today.

---

## Suggested sequencing at a glance

```
Phase 0  Company identity + Accounts department        ─┐
Phase 1  GST + TDS rate masters                          │  can start in parallel
                                                           │  once Phase 0 lands
Phase 2  Sales Invoice + Credit Note      ──┐             │
Phase 3  Vendor Bill + Debit Note         ──┤  each depends on Phases 0–1
Phase 4  Payroll export wiring            ──┘

Phase 5  General Ledger & Financial Statements  ← Shanti Ops owns the books;
                                                    needs Phases 2–4's documents to exist first

Phase 6  Optional Tally Sync                    ← genuinely optional, build only if/when needed

Phase 7  Cheque Printing / Forex                 ← opportunistic, anytime, no dependency
                                                    (Fixed Assets shipped 2026-08-22, see §5aa/§5z)

Phase 8  Bank reconciliation: statement import   ← real V1 gap, no paid service needed, do next
Phase 9  Report depth: Asset Register /            ← real V1 gap, no paid service needed
         Depreciation Schedule / Cash Flow
Phase 10 Government-connected compliance          ← explicitly deferred — build only when a real
         (e-invoice / e-way bill / 26Q)              threshold/business need actually triggers it
```

Phases 2 and 3 can run in either order or in parallel once 0–1 are done — pick whichever side
(sales or purchase) has the more urgent real business need.

---

## Progress so far (2026-08-20)

Phases 0–4 are built and live-verified — see SYSTEM.md §5q–§5u for the as-built detail on each.
In short: `Accounts` department + `company_settings` (real GSTIN/PAN/address, not placeholders —
found in `lib/qc-doc-pdf.js`'s `COMPANY_PROFILES`); `gst_rates`/`vendor_tds_rates` masters;
`sales_invoices`/`sales_invoice_items`/`sales_credit_notes` with a real CGST/SGST/IGST split
(`lib/gst-calc.mjs`); `vendor_bills`/`vendor_bill_items`/`purchase_debit_notes` mirroring it on the
purchase side, TDS actually deducted; `salary_slips.payroll_export_status` wired. The whole
document trail is done.

**Phase 5 is now fully built and live-verified** — see SYSTEM.md §5v (Ledger + GST compliance) and
§5w (completion pass) for the as-built detail. Chart of Accounts + double-entry posting engine
(`journal_entries`/`journal_entry_lines`, auto-posted off Sales Invoice/Vendor Bill/Credit
Note/Debit Note/Salary Slip) + Trial Balance/P&L/Balance Sheet reports; GST compliance per the
current model (GSTR-1/GSTR-1A/IFF outward, GSTR-2B/IMS-based ITC reconciliation inward, GSTR-3B);
Manual Journal Entry (draft → post → immutable → reversal); inventory consumption costing
(weighted-average — confirmed by inspection to be the first valuation method the app ever had, not
a second parallel one — Vendor Bill receipt values stock in, Material Issue consumes it out at
cost); AR/AP settlement (`customer_receipts`/`vendor_payments`, posting Bank & Cash against
AR/AP, auto-settling the parent document); bank reconciliation (a manual tick-off workflow against
the Bank & Cash control account — deliberately not a `bank_accounts` master, that stays Phase 7's
job). Known, deliberate gaps: a Vendor Bill/Material Issue line with no traceable catalog `item_id`
still isn't costed (real, pre-existing data-quality gap, not something this pass could safely paper
over); no Rule 42/43 proportional ITC reversal; no live GST-portal/API connection.

## Prompt to hand a fresh chat for Phase 5

```
Read ACCOUNTING-READINESS.md and ACCOUNTING-IMPLEMENTATION-PLAN.md fully first — Phases 0-4 are
already built and live-verified (see SYSTEM.md §5q-§5u for exactly what exists: company_settings,
gst_rates/vendor_tds_rates, sales_invoices/sales_credit_notes, vendor_bills/purchase_debit_notes,
salary_slips.payroll_export_status). Don't re-derive any of that — read it, then build on it.

Now build Phase 5 (General Ledger & Financial Statements) — the plan's own scope for it. This is
the first phase where "post a journal entry" and "compute a balance" are actually in scope, per
the 2026-08-20 architecture decision that Shanti Ops (not Tally/ERPNext) owns the full ledger.

Before writing code, resolve these with me directly — they need real accounting judgment, not an
assumption:
1. The default Chart of Accounts — which heads under Assets/Liabilities/Income/Expense/Equity to
   seed, and at what granularity (e.g. does "Accounts Receivable" need to be per-customer or one
   control account; does raw-material purchase need to split by category).
2. The exact account mapping for each auto-post trigger — e.g. issuing a Sales Invoice should post
   which debit/credit pair (AR vs. Revenue vs. GST payable accounts), a Vendor Bill which pair
   (Expense/Inventory vs. AP vs. GST input vs. TDS payable), a Credit/Debit Note, and a paid
   Payroll salary slip. Get this right once, since every downstream report depends on it.
3. Whether auto-posting fires on "issued" status (my working assumption from the plan) or a
   separate "post to ledger" action — some businesses want a review step between issuing a document
   and it hitting the books.

Then build: a per-company Chart of Accounts (admin-editable, seeded with whatever we agree in
question 1); journal_entries/journal_entry_lines (double-entry, source_type/source_id linking back
to sales_invoices/vendor_bills/sales_credit_notes/purchase_debit_notes/salary_slips); Trial
Balance/P&L/Balance Sheet as derived read-only reports per company per date range; GST compliance
per the current model — GSTR-1/1A/IFF generated from Sales Invoice line data at Phase 1's GST
rates for the outward side, and GSTR-2B/IMS-based ITC reconciliation against Vendor Bill line data
feeding GSTR-3B for the inward side (see the "GST compliance" bullet under Phase 5's Build section
for the full flow — this is not the old GSTR-1/2/3 model). Non-goals: no multi-currency, no
budget-vs-actual beyond what Work Order Costing already gives, no automated period-close/lock.

Follow the "Ground rules for every phase" section exactly — mirror existing patterns (the counters
table for numbering, the addColumn/CREATE TABLE IF NOT EXISTS idiom, ACTION_CATALOG for every new
action). This phase's real calculation logic (double-entry balance validation, trial balance
rollup) needs a dependency-free lib/*.mjs + matching *-selfcheck.mjs, same as lib/gst-calc.mjs.
Live-verify against the real dev DB the same way every prior phase did (it's a remote Turso DB —
see the dev-server-uses-remote-turso note; clean up test rows via the Turso HTTP API afterward,
same as every phase so far since there's no DELETE route on most of these tables).

This phase is meaningfully bigger than Phases 0-4 — consider whether to split it into sub-steps
(Chart of Accounts + posting engine first, reports second, GST compliance — GSTR-1/1A/IFF and
GSTR-2B/IMS-based ITC reconciliation feeding GSTR-3B — third) rather than one giant diff.
Stop and report after each sub-step, or after the whole phase if you do it as one, with a
live-verification pass before moving on.
```

**Source note (GST terminology, 2026-08-20 pass):** Phase 5's "GST compliance" bullet and every
GSTR reference in this document were checked against the GST Portal's current outward-supply and
ITC workflows (GSTR-1 / GSTR-1A / IFF for outward supplies; GSTR-2B + IMS for recipient-side ITC;
GSTR-3B as the operative monthly return), not the older GSTR-1/2/3 model this document originally
used or any legacy ERP-implementation checklist. GSTR-2 is legacy terminology — it was never
notified as a filable return and isn't part of the current compliance cycle.
