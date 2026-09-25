# Sales CRM — phased improvement plan

Revised 2026-09-25. Scope is **Sales only** — Marketing will be designed later (see "Marketing,
for now").

## Status (2026-09-25)

**Phase 1 is done** (1a–1k; SYSTEM.md §5db). Paused before Phase 2 at the client's request: new
data is coming (Product Master, more customers — with duplicates — and Techno Fab orders and
payment log), and a global company selector (All / Shanti Boilers / Shanti Techno Fab) is to be
added first. Phases 2–4 follow after that.

## Context

The Sales department (`/sales`, Sales reports) already has most of the client's spec built
(Sales CRM expansion, 22–23 Sept): Product Master, enquiry actions, Commercial Offer, 2-step PO
wizard, Diary, Home-calendar follow-ups, 13 Sales Call reports. A code audit found the pieces don't
connect well enough for daily use:

- Enquiry products never reach the quotation or PO (quotation lines search the engineering Item
  Master; PO lines are typed by hand; one product per enquiry).
- Funnel report Value is always 0 (enquiries have no value) and Probability % is a placeholder.
- Each enquiry has two statuses that can disagree (`leads.status` vs `leads.sales_call_status`),
  plus a third copy of the stage on the Opportunity created at conversion.
- A/C Manager / Order Stage on the PO are free text, so the Prospect Summary silently drops orders
  on a spelling mismatch.
- PO wizard is missing GST No, Entity Code, PAN, Customer Code, customer PAN, SOS No (screen + PDF).
- Diary: no "Plan Action Type"; "Alert seniors" / SMS are saved but do nothing.
- Calendar actions navigate away instead of opening in place; funnel drill-down lacks the link,
  quote price and follow-up tooltip.
- Reports are tables without charts, and the 19 CRM/Sales Call reports have no CSV/Excel download.
- No customer overview, competitors, installed base or quote revisions.

## Decisions

- **Product Master is what the company sells**; Item Master is what products are built from.
  Quote/PO lines pick from Product Master. Product data comes later from the client's current CRM
  — build the schema skeleton now. A per-product BOM template link is future work.
- **The 9-stage funnel is the only status**, and **the enquiry is the deal** (Sales stops using the
  separate Opportunity record).
- **Visibility:** a Sales member sees their own records; the Sales Head and PMs see everything.
- **`/sales` holds daily operations only** (enquiries, quotations, orders, payments, Customer 360).
  Dashboards and analysis live in **Reports**: charts that explain the numbers, a details table
  below, CSV + Excel download.
- **In-app alerts now**; SMS/WhatsApp later.
- **Email (Zoho) is deferred** until hosting is decided (Render paid tier supports SMTP, or
  Cloudflare). Until then, the existing "Email isn't configured" message stays.
- **Import from the client's current CRM** later: products, customers & contacts, open enquiries +
  diary history, past quotations.

## Current data (read-only check of the shared database, 2026-09-25)

| Table | Rows | What it means for the plan |
|---|---|---|
| `leads` | **0** | Status unification (1a) and stage history (1c) need no backfill. |
| `crm_notes` (Diary) | **0** | Nothing to re-point. |
| `opportunities` | 5 — all demo seed rows from 25 Aug (3 Sales, 2 Marketing), no linked lead, no items, and stages still named `Lead/Qualified/Quoted/Won`, which no longer exist in `sales_stages` | No Sales migration needed (1b): the 3 Sales demo rows are left inert. Marketing's 2 untouched. |
| `quotations` | 2 (both accepted, `company` blank) | 1f/1g apply to new quotations; the 2 blank-company rows get a letterhead default (Shanti Boilers) on read, flagged. |
| `sale_orders` | 1,006 — all from the legacy Excel import; 12 distinct sales-person names ("Amit B" 400, "Sales Desk" 237, "Unassigned" 122, "BDM" 115, "Devansh B" 84 …) | Only 2 active Sales users exist (`sales_head`, `sales`/kalyani). Legacy names won't match users → under 2a these orders are Head-only; 1i keeps each legacy name visible (read-only) rather than forcing a user. |
| `sales_products`, `branches`, `sales_targets` | **0** each | Masters are empty until the client's data arrives; verification uses `ZZ-` test rows. Prospect Summary / Employee 360 will show real numbers only once branches, targets and managers exist. |
| `customers` | 340 | Duplicate check (1k) and Customer 360 work against these. |

## Ground rules (every phase)

- **The shared Turso database is treated as production.** Before any data migration: back up the
  affected tables (same pattern as `scripts/backup-procurement-tables.mjs` /
  `scripts/restore-items-backup.mjs`), prove restore works, run a dry run, then apply. Migrations
  are one-time and guarded by a `system_migrations` marker. Test rows are `ZZ-` prefixed and deleted
  afterward with a zero-residue check.
- Additive schema only (`addColumn()` / `CREATE TABLE IF NOT EXISTS` in `lib/db.js` `migrate()`);
  old tables left in place, inert, never dropped.
- Permissions through `requireCrmAction` / `ACTION_CATALOG` (`lib/action-permissions.js`); new admin
  actions Head-only. Audit via `audit()`.
- Keep `docs/sales-crm-plan.md` in sync with this plan (first commit of implementation copies the
  "Current data" section across).
- Each phase updates the Sales guide (`components/department-help-content.jsx`) and adds one dated
  SYSTEM.md section.

---

## Phase 1 — Connect the flow: enquiry → quotation → PO

Build order (each step committed and verified separately): record model first — 1a one status,
1b retire Opportunities for Sales, 1c stage history — then products (1d–1g), the PO wizard (1h),
then 1i–1k.

**1a. One status — the funnel**
- Remove the old status column/filter/select; the stage badge is the status. `leads.status`
  becomes system-maintained: `converted` on convert (`lib/crm.js`), `lost` when the stage is an
  `is_lost` stage, else open. `PATCH /api/leads/[id]` stops accepting a manual `status`.
- Enquiry tab = open leads in stages before "Proposals" (by `sort_order`), not `status='new'`.
- Update readers of `leads.status`: `getSalesFlowCounts()` (`lib/data.js`), `isSlaBreached`,
  the CRM report panels (`components/CrmReportPanels.jsx`).

**1b. Retire Opportunities for Sales — the enquiry is the deal**
- The enquiry absorbs what the Opportunity carried: `value_num` → `leads.expected_value`,
  `opportunity_items` → `lead_products` (1e), and the `opportunity_id` links on `crm_notes`, CRM
  tasks, `quotations`, `sale_orders` (new nullable `lead_id` on quotations and sale orders).
- **Board view** toggle on the Leads tab (same native HTML5 drag pattern as
  `components/PipelineWorkspace.jsx`); dragging sets `sales_call_status`.
- **No data migration needed** (see Current data): the only Sales opportunities are 3 demo rows
  with no lead, notes or items. They are left in place, inert. `opportunities` stays in the schema.
- `resolveLeadToCustomer` (`lib/crm.js`) stops creating an opportunity for Sales leads.
- Sales Pipeline / By Department / Agent Performance reports read leads.
- The **Pipeline** nav tab is removed for Sales users (`components/Nav.jsx`); a Sales user hitting
  `/pipeline` is redirected to `/sales?tab=leads&view=board`.

**Marketing, for now** — nothing Marketing uses changes: `/pipeline` stays for Marketing heads,
showing Marketing-owned opportunities only; Marketing-owned rows are never migrated; Campaign
Performance keeps reading opportunities. When Marketing is designed, it gets its own plan.

**1c. Stage history** — new `lead_stage_history` (lead_id, from_stage, to_stage, changed_by,
changed_at), written wherever `sales_call_status` changes (lead PATCH, Board drag, PO wizard step 1,
Order Lost, Close Sales Call). Feeds time-in-stage and win-rate reports in Phase 3.

**1d. Product Master skeleton** (`sales_products`, `app/api/sales-products/*`, Masters → Products)
- Add `unit`, `hsn_code`, `gst_pct`, `bom_structure_template_id` (nullable, schema only — future
  product → BOM link). Products form gains Unit / HSN / GST %.

**1e. Multiple products per enquiry**
- New `lead_products` (lead_id CASCADE, product_id nullable, description, qty, unit, rate,
  sort_order); guarded backfill from `leads.product_id` / `leads.product`.
- Product line repeater on `AddEnquiryDialog` / `LeadDetailSheet` (`components/SalesWorkspace.jsx`)
  reusing `ProductSearchField`; free text allowed while the catalog is empty.
- `leads.expected_value` auto-set to the lines' total, editable. First line still written to
  `leads.product_id` so existing reports keep working.

**1f. Quotation lines from Product Master**
- `quotation_items.product_id`; `QuotationItemField` searches `sales_products`; rate from
  `product.price`. (Price Lists stay on Item Master until Phase 4.)
- "Create Commercial Offer" pre-fills lines from `lead_products`.
- `lib/quotation-pdf.js`: Sr No / Particular / Unit / Qty / Rate / Disc % / Rate after Disc / Amount.
- `app/api/quotations/[id]/convert/route.js` copies `product_id` and discount into
  `sale_order_items` (add `discount_pct`).

**1g. GST per line** — quotation lines take GST % from the product (editable); quotations compute
CGST+SGST vs IGST with `gstSplit()` (`lib/gst-calc.mjs`) like invoices and the PO wizard.

**1h. PO wizard items + missing fields** (`components/SaleOrderWizard.jsx`, `lib/sale-order-pdf.js`)
- Items as a table: Product Code (picker), Description, Warranty Std | Accepted, From Date Of (D/I),
  Inst Req, Preventive Maintenance, Qty, Unit Price, Tax %, Total Price; footer Total Order Value.
  Pre-filled from the quotation, else from `lead_products`.
- Discount as amount and %, via `lib/sale-order-calc.mjs`.
- Read-only on screen and PDF: GST No / Entity Code / PAN (`company_settings`), Customer Code / PAN
  (`customers.party_code` / `pan`), SOS No (linked project's Scope of Supply).
- Address 3 rows; Order Stage → funnel dropdown; A/C Manager → user dropdown (1i).

**1i. Account manager identity** — store the **username** in `leads.account_manager` and
`sale_orders.sales_person_override`; dropdowns list active Sales users. Reports key by username,
resolving legacy text by username/display-name match; unmatched legacy names stay their own row.
Payment Tracker's hard-coded Sales Person list uses the same source.

**1j. Diary "Plan Action Type"** — `crm_notes.plan_note_type` + a select in `AddToDiaryDialog`.

**1k. Duplicate check at conversion** — before `resolveLeadToCustomer` creates a customer, show
likely matches (normalized name via `normalizeWords` in `lib/match-utils.js`, GST No, phone); pick
one or create new. Same warning on Add Customer / Add Enquiry.

---

## Phase 2 — Daily usability (on `/sales` and Home)

**2a. Own-records visibility + server-side loading** (first; both change data fetching)
- A Sales member sees a lead/quotation/order where they're the A/C manager, assignee or creator
  (quotations/orders inherit from their lead). `isDepartmentHead(user,'Sales')` and PMs see all.
- Enforced in the data layer and every GET/PATCH route (`app/api/leads/*`, `quotations/*`,
  `sale-orders/*`, `sale-order-payments/*`, `crm-notes`) and in Reports data — not just the UI.
  Legacy imported orders with no matching user: Head-only.
- `app/sales/page.js` stops loading every row up front: paged, filtered lists per tab via API.

**2b. Home calendar overlay** (`components/ProductionToday.jsx`) — follow-ups as a table (SN, Date,
In/Out time, Org, Location, Contact, Objective, Task type, Action taken, Actions). Update Now,
Advanced Update and New Enquiry open `AddToDiaryDialog` / `AddEnquiryDialog` in place (exported
from `SalesWorkspace.jsx`); Add Expenses unchanged.

**2c. Real alerts** — Diary save (`app/api/crm-notes/route.js`): "All seniors" →
`notifyDepartmentHeads('Sales')`; "Selected seniors" → `notifyUser` per picked user; the "Plan of
Action for" person is notified. SMS select shows "SMS — coming later".

**2d. Quotation follow-up reminders** — daily run via the existing Cloudflare cron Worker pattern
(`workers/rate-sync-cron/`: secret-authed endpoint + heartbeat row), sweep-on-read as backup (same
as `sweepDrawingNotifications`). Sent quotations expiring in ≤3 days, expired with no order, or sent
≥7 days with no Diary activity → `notifyUser` to the owner, deduped per quotation+reason. A
"Needs follow-up" filter on the Quotations tab.

**2e. Mobile** — every new table (calendar overlay, PO items, lead products) has a card layout
below `md`, same pattern as the Projects list.

---

## Phase 3 — Reports that explain the numbers

**3a. Shared report layout** — one pattern for every Sales report: filters (date range, branch,
manager, customer, read from the URL so other pages can deep-link) → KPI tiles → chart(s) →
details table → **Download CSV / Excel**. Charts reuse Recharts (`components/executive/charts.jsx`)
and follow the dataviz skill's rules (palette, light/dark, axis/tooltip formatting).

**3b. CSV + Excel for every report**
- Catalog reports: the export route (`app/api/reports/[key]/export/route.js`) already does
  `pdf|xlsx` from `toTable()`; add `csv`.
- `hasOwnControls` reports (CRM + Sales Call panels, computed in the browser): a shared client
  helper exports the exact rows the table renders (`xlsx` is already a dependency), so the download
  can never disagree with the screen.

**3c. Employee Performance 360** (new) — for one A/C manager or the whole team:
- KPIs: enquiries, sales calls, planned vs actual follow-ups, quotations sent + value, orders won +
  value, win rate, target vs achievement, average days per stage (from 1c), expenses, cost per order.
- Charts: target vs achieved by month, funnel by stage, activity trend (calls/follow-ups per week),
  team comparison when viewing everyone.
- Details table below (one row per manager, or per enquiry when one manager is picked), exportable.
- Replaces nothing: Agent Performance / Employee Follow-up stay as narrower views.

**3d. Funnel report, made real** — `sales_stages.probability_pct` (editable in Masters → Funnel
Stages, Head-only); Value = Σ `expected_value`; Probability (Value) = Value × %. Funnel chart above
the table. Drill-down becomes a table (customer, short name, address, enquiry date, contact/mobile,
email, product type, stage + latest quote total, expected date, A/C manager, follow-up tooltip via
`DiarySummaryTooltip`); customer name opens the enquiry (`/sales?tab=leads&highlight=LD-{id}`).

**3e. Sales Overview** (new report, not on `/sales`) — orders this month vs target, open funnel
value, weighted forecast, quotations needing follow-up, trend charts.

**3f. Upgrade the existing Sales reports** to 3a's layout, most-used first (Prospect Summary,
Funnel, Customer Follow-up, Quotation Listing, Employee Follow-up, then the rest). Every report
honours 2a's visibility rule.

---

## Phase 4 — Customer 360 and CRM depth

- **Customer 360** (on `/sales`, from the Customers tab): one view of a customer's enquiries, diary,
  quotations, orders, projects, invoices, payments, service calls/contracts, with "Open in Reports"
  links that open the relevant reports pre-filtered to this customer (3a's URL filters).
- **Competitors**: `customer_competitors` (customer/lead, competitor, product, price, notes);
  Order Lost gains "Lost to competitor"; a competitor view in Reports.
- **Installed base**: equipment a customer bought (sale order items + projects, with warranty from
  `warranty_*_days` / `from_date_of`) shown in Customer 360 → AMC/spares follow-ups; linked to
  `service_contracts`.
- **Quotation revisions** (`parent_quotation_id`, `revision_no` → R1/R2) and Head approval above a
  discount % (new Head-only action key).
- **Price Lists re-keyed to Product Master** (table rebuild so `item_id` becomes nullable, add
  `product_id`), with a backup first.

---

## Phase 5 — Import from the client's current CRM (needs an export sample)

Same shape as `scripts/import-sales-tracker.mjs`: dry run by default, `--apply` to write, rows
tagged `created_by='import:legacy-crm-<date>'` for rollback, a data-issues doc for the client.
Built against a real export file. Order:
1. **Products** → `sales_products`.
2. **Customers & contacts** → matched against existing customers (normalized name, GST No, phone);
   also re-link the 846 Payment Tracker orders that only have a customer name (SYSTEM.md §5ct).
3. **Open enquiries + diary history** → `leads`, `lead_products`, `crm_notes`; old stages mapped to
   the 9-stage funnel with the client first; A/C managers mapped to users.
4. **Past quotations** → `quotations` + items, marked legacy, linked to enquiry/customer.

Can start any time after Phase 1.

---

## Deferred

- **Email sending (Zoho)** — after the hosting decision. Design when picked up: `nodemailer`
  behind `lib/mail.js`; per-user Zoho app password encrypted with `encryptSecret`
  (`lib/crypto.js`), never returned by any API; optional shared `sales@` sender per company with
  Reply-To = salesperson; company dropdown on the send screen re-renders the template and letterhead;
  PDF attached; BCC the sender so it shows in their Zoho Sent folder. ZeptoMail (one API key) is the
  alternative if SMTP isn't available.
- **Marketing workspace** — its own plan later (enquiry capture, handoff to Sales, campaign cost/ROI).
- SMS/WhatsApp provider; Product → BOM template UI; payment-overdue reminders tied to Accounts.

---

## Verification (each step)

- `npm run lint`; selfchecks for any new pure helper (e.g. funnel value math, visibility predicate).
- Live on the dev server against the shared database as `sales_head`, a Sales **member** login
  (visibility), and `marketing_head` (confirm Marketing's `/pipeline` and Campaigns are unchanged).
- Phase 1 golden path: enquiry with 2 products → Commercial Offer pre-filled → convert → PO wizard
  shows the same lines, derived GST/PAN/SOS fields, correct totals → order PDF → Prospect Summary
  counts it under the right manager. Board drag changes stage and writes history; a Sales user's
  `/pipeline` redirects; a Marketing user's `/pipeline` still shows its 2 opportunities.
- After each step, re-run the row counts in "Current data" to confirm nothing outside the test rows
  changed (the 1,006 imported orders, 340 customers, 2 quotations, 5 opportunities).
- Phase 3: each upgraded report's CSV and Excel match the on-screen table row for row.
- Every migration: backup taken, restore proven, dry-run counts reviewed before `--apply`.
