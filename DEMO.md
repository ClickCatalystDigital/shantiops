# SB Ops public demo: what's in it and how to walk it

boiler-erp.ahromlabs.com. Fictional company **Acme Boilers** (`scripts/demo/acme-seed.json`); every customer, supplier and
person is made up. The data comes from `scripts/demo/seed-acme.mjs` and is rebuilt every night (see "Nightly reset").

## The five projects

| Project | Customer | Model | Where it stands |
|---|---|---|---|
| **AB-1001** | Sunrise Dairy Cooperative | Solid Fuel 600 kg/hr (SF) | **Complete.** Invoice paid in full. |
| **AB-1002** | Riverside Textiles Ltd | Combination Fuel 1000 kg/hr (CF) | **Complete.** Invoice 60% paid. |
| **AB-1003** | Bluewave Chemicals Ltd | Multi Fuel 2000 kg/hr (MF) | **Complete.** Advance only (70% receivable). Shipped as two packing lists on one shipment (SHP-1001). |
| **AB-1004** | Northstar Paper Mills | Oil & Gas 1500 kg/hr (OF) | **In Procurement.** |
| **AB-1005** | Greenfield Foods Pvt Ltd | Combination Fuel 1000 kg/hr (CF) | **In Production / QC.** |

A complete project shows every stage, in order:
enquiry → quotation (QTN-n) accepted → sale order (SO-n) with Scope of Supply → calculation sheet + 3 approved drawings →
BOM released → two supplier quotes per line, supplier picked, PO issued → gate entry, GRN, inward approval, routed to
Production/Dispatch → incoming inspection passed → material issued, 6 job cards done → hand-over to Dispatch → hydro test,
test certificates, QC folder (ABH-AB-100n, IBR 2026, every part and bought-out item linked, shared with the customer) →
packing list packed, pre-dispatch approval (QC + Production), dispatched, delivery acknowledged → 2 site visits,
commissioning report (FSR-100n, finalised), a later service call → sales invoice (AB/n/2026-27) with receipts, supplier
bills against every PO. Small catalog items (gauges, gaskets, studs) come from opening stock, not new POs.

**AB-1004 (Procurement)**: plates and angle received and waiting in Stores' inward approval queue; tubes and pipe in
transit; water-level gauge ordered; safety valve on a **draft PO**; other valves and the pump at quote comparison;
blow-down valve and pressure gauge on an **RFQ** (RFQ-1). Current milestone: Ordered.

**AB-1005 (Production / QC)**: two job cards done, one running, three pending; the stay-tube lot **failed** incoming
inspection with an **NCR**; two inspections still pending; material indent IND-1001 for the furnace plates. Current
milestone: Shell Welding (due today, so it shows on Today and Executive "Needs your attention").

Also seeded: open enquiries at Hot Offers (Metro Hospital Trust, quotation sent), Follow-up (Kaveri Pharma) and an
overdue Lead-Hot call (Harvest Rice Mills); one lost and one dropped enquiry with reasons; call notes on every
enquiry; an opportunity (Sunrise Dairy's second boiler); two campaigns; sales-side payment tracker entries (advances on
all five orders); one task per department due in the next few days; a week of worker and staff attendance; leave
balances, one approved and one pending leave request.

## Which login shows what

Visitors pick a role on `/demo` (`lib/demo-roles.js`); no password.

**Owner pass.** A short PIN, the Worker secret `DEMO_PASS` (4+ characters; `npx wrangler secret put DEMO_PASS`). Type it under **Have a demo pass?** on `/demo`, or open `/demo#pass=<PIN>`. `/api/demo/pass` sets `demo_lead` to an HMAC of the PIN: that browser skips the form, is never saved or emailed as a lead, and asks OPS AI without a limit. Wrong tries are capped at 5 per visitor IP and 200 in all per day (`demo_pass_tries` in the leads DB). Change the secret to cancel every pass (`lib/demo-leads.js`).

| Login | Start here |
|---|---|
| Owner / Manager | Executive: 2 active projects, value in progress, collected 44%, outstanding by customer, AB-1005 needs attention. Projects → AB-1001 for the full chain on one page. |
| Sales | Enquiries board (every stage), Metro Hospital's quotation, sale orders and payment tracker. |
| Design | Calculation sheets and drawings per project; task "Revise tube layout for AB-1005". |
| Engineering | BOM tree of any project; release history. |
| Procurement | AB-1004: comparison, draft PO, RFQ-1, orders in transit. |
| Stores | Inward approvals waiting for AB-1004; inventory (MS angle below its reorder point). |
| Production | AB-1005 job cards, material indent, worker attendance; hand-overs for the complete projects. |
| Quality (QC) | AB-1005's failed inspection and NCR, pending inspections; QC folders of AB-1001..1003 (open the PDF). |
| Dispatch | Dispatched packing lists, SHP-1001, pre-dispatch approvals. |
| Service | Site visits and commissioning reports (FSR-1001..1003), service calls. |
| Accounts | Sales invoices and receipts (paid / part-paid / advance), supplier bills, journal entries. |
| HR | Employees, attendance, leave requests. |

## Not in the demo

- Customer Portal (blocked in demo mode).
- Uploaded files: drawings carry no file (approved by status only), no test-certificate scans, no photos. The demo has no file storage.
- Payroll, work orders, service contracts, GST filings, fixed assets: no data.

## Nightly reset and dates

`workers/demo-reset-cron` (03:00 IST) deletes `sb-demo`, recreates it from `sb-demo-golden`, then moves every date
forward by *today − `demo_meta.seeded_on`* (the seed writes that row). Every text column holding `YYYY-MM-DD…` or a
`YYYY-MM` month moves; time parts are kept. Limits:
- Dates inside JSON or free text don't move (e.g. dates typed into a commissioning report's fields, notes that mention a date).
- Financial-year codes don't move: invoice and PO numbers such as `AB/1/2026-27`, `101/AB/2026-27`. After 31 March the
  dates are in the next financial year but the numbers keep the old one. Re-seed the golden copy once a year (April).
- Holiday dates and joining dates move too.

## Rebuilding the golden database

1. Recreate an empty `sb-demo-golden` (ask Pujan first: the live demo copies it every night).
2. Boot the app against it once with `CUSTOMER_SEED="$(cat scripts/demo/acme-seed.json)"` and `ADMIN_PASSWORD`, so `migrate()` builds the schema.
3. `DB_URL=… DB_TOKEN=… BASE=<that app> ADMIN_PASSWORD=… node scripts/demo/seed-acme.mjs` (a few minutes). It prints row counts and fails if any listed table is empty.
4. `DB_URL=… DB_TOKEN=… BASE=… ADMIN_PASSWORD=… node scripts/demo/scrub-check.mjs` — database, browser bundle (after `npm run cf:build`), PDF templates, AI prompts, pages, and every PDF the demo prints; must report 0 hits.
5. Trigger the reset Worker (POST with `x-trigger-key`) and walk the demo.

For a local run use a scratch SQLite file (`TURSO_URL=file:/tmp/x.db`, and blank `TURSO_AUTH_TOKEN`): `.env.local` points at the client's live database.
