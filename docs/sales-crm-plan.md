# Sales CRM — phased improvement plan

## Context

The Sales department (`/sales`, `/pipeline`, Sales reports) already has most of the client's spec
built (Sales CRM expansion, 22–23 Sept): Product Master, enquiry actions, Commercial Offer, 2-step
PO wizard, Diary, Home-calendar follow-ups, 13 Sales Call reports. A code audit found the pieces
don't connect well enough for daily use:

- Enquiry products never reach the quotation or PO (quotation lines search the engineering Item
  Master; PO lines are typed by hand; one product per enquiry).
- Funnel report Value is always 0 (enquiries have no value) and Probability % is a placeholder.
- Each enquiry has two statuses that can disagree (`leads.status` vs `leads.sales_call_status`).
- A/C Manager / Order Stage on the PO are free text, so the Prospect Summary silently drops orders
  on a spelling mismatch.
- PO wizard is missing GST No, Entity Code, PAN, Customer Code, customer PAN, SOS No (screen + PDF).
- Diary: no "Plan Action Type"; "Alert seniors" / SMS are saved but do nothing.
- Calendar actions navigate away instead of opening in place; funnel drill-down lacks the link,
  quote price and follow-up tooltip.
- Email sending always fails (no provider). No 360° pieces (competitors, installed base, quote
  revisions, customer overview).

Decisions from the user:
- **Product Master is what the company sells**; Item Master is what products are built from.
  Quote/PO lines pick from Product Master. Product data will be loaded later from the client's
  current CRM — build the schema skeleton now. A per-product BOM template link is future work.
- **The 9-stage funnel is the only status** users see/set.
- **Email via Zoho Mail SMTP**, app password entered per Sales user (fixable later).
- **In-app alerts now**, SMS/WhatsApp later.
- **The enquiry is the deal.** Retire the separate Opportunity record and `/pipeline` unless it
  adds something the enquiry can't carry (its Kanban board moves onto the enquiry list).
- **Visibility: a Sales member sees their own records; Sales Head and PMs see everything.**
- **Import from the client's current CRM**: products, customers & contacts, open enquiries + diary
  history, past quotations (once an export is available).

Every phase: additive schema via `addColumn()` / `CREATE TABLE IF NOT EXISTS` in `lib/db.js`
`migrate()`, permissions through `requireCrmAction` / `ACTION_CATALOG`
(`lib/action-permissions.js`), audit via `audit()`, one new dated SYSTEM.md section per phase.

---

## Phase 1 — Connect the flow: enquiry → quotation → PO

Build order inside the phase (each step committed and verified separately): the record model first
— 1e one status, 1h retire Opportunities, 1i stage history — then products (1a, 1b, 1c, 1k), then
the PO wizard (1d), then 1f, 1g, 1j.

**1a. Product Master skeleton** (`sales_products`, `app/api/sales-products/*`, Masters → Products)
- Add columns: `unit`, `hsn_code`, `gst_pct`, `bom_structure_template_id` (nullable FK to
  `bom_structure_templates`, schema only, no UI — the future "product → BOM" link).
- Products tab form gains Unit / HSN / GST %. Existing `PRODUCT_TYPES` (`lib/sales-product-types.js`)
  stays the pick-or-type type list.

**1b. Multiple products per enquiry**
- New `lead_products` (lead_id CASCADE, product_id nullable → sales_products, description, qty,
  unit, rate, sort_order). One-time guarded backfill (`system_migrations` marker) from existing
  `leads.product_id` / `leads.product`.
- `AddEnquiryDialog` / `LeadDetailSheet` (`components/SalesWorkspace.jsx`): a product line
  repeater reusing `ProductSearchField` (picks fill description/unit/rate from the product; free
  text still allowed while the catalog is empty).
- New `leads.expected_value` (REAL) — auto-set to the lines' total, editable. Keep writing the first
  line into `leads.product_id` so existing reports keep working.

**1c. Quotation lines from Product Master**
- `quotation_items.product_id` (nullable). `QuotationItemField` searches `sales_products`
  (code/name/type) instead of `/api/items`; rate pre-fills from `product.price`; free text allowed.
  (Price Lists stay on Item Master until Phase 4 — they're keyed `item_id NOT NULL`.)
- "Create Commercial Offer" from an enquiry pre-fills the quotation lines from `lead_products`.
- `lib/quotation-pdf.js`: Sr No / Particular / Unit / Qty / Rate / Disc % / Rate after Disc / Amount.
- `app/api/quotations/[id]/convert/route.js`: copy `product_id` and discount into `sale_order_items`
  (`sale_order_items.product_id` already exists; add `discount_pct`).

**1d. PO wizard items + missing fields** (`components/SaleOrderWizard.jsx`, `lib/sale-order-pdf.js`)
- Items as a real table: Product Code (Product Master picker), Description, Warranty Std | Accepted,
  From Date Of (D/I), Inst Req, Preventive Maintenance, Qty, Unit Price, Tax %, Total Price; footer
  Total Order Value. Pre-filled from the quotation, else from `lead_products`.
- Totals: Discount as amount **and** %, reusing `lib/sale-order-calc.mjs`.
- Read-only derived fields on screen and PDF: GST No / Entity Code / PAN from `company_settings`
  for `so.company`; Customer Code / PAN from `customers.party_code` / `pan`; SOS No from the linked
  project's Scope of Supply (`getScopeOfSupply`) when a project exists.
- Address textarea 3 rows; Order Stage → funnel dropdown (`getSalesStages()`); A/C Manager → Sales
  user dropdown (see 1f).

**1e. One status — the funnel**
- UI: remove the old status column/filter/select; the stage badge is the status. `leads.status`
  becomes system-maintained only: `converted` on convert (`lib/crm.js`), `lost` when the stage is an
  `is_lost` stage, else `open`-equivalent. `PATCH /api/leads/[id]` stops accepting a manual
  `status`; setting `sales_call_status` updates it.
- Enquiry tab = open leads in stages before "Proposals" (by `sort_order`), not `status='new'`.
- Update readers of `leads.status`: `getSalesFlowCounts()` (`lib/data.js`), `isSlaBreached`,
  Lead Funnel / Agent Performance panels (`components/CrmReportPanels.jsx`).

**1f. Account manager identity**
- Store the **username** in `leads.account_manager` and `sale_orders.sales_person_override`
  going forward; dropdowns list active Sales users (`getFunctionalHeads()` filtered, as
  `app/sales/page.js` already does). Display name shown everywhere.
- Prospect Summary / Employee reports key by username, resolving legacy text values by matching
  username or display name; unmatched legacy names still show as their own row.
- Payment Tracker's hard-coded Sales Person list → same user source.

**1g. Diary "Plan Action Type"** — `crm_notes.plan_note_type` + a select in `AddToDiaryDialog`.

**1h. Retire Opportunities — the enquiry is the deal**
- What `/pipeline` carries today that the enquiry must absorb: the drag-and-drop stage Kanban
  (`components/PipelineWorkspace.jsx`), `opportunities.value_num`, `opportunity_items`, and the
  `opportunity_id` links on `crm_notes`, CRM tasks, `quotations`, `sale_orders`.
- Add a **Board view** toggle on the Leads tab (same native HTML5 drag pattern as
  `PipelineWorkspace`), dragging sets `sales_call_status`.
- One-time guarded migration: for each opportunity with a source lead, copy `value_num` →
  `leads.expected_value` (if empty), `opportunity_items` → `lead_products` (if the lead has none),
  and add `lead_id` to quotations/sale orders (new nullable columns) + re-point notes/tasks. An
  opportunity with no lead becomes a lead. Old tables stay in place, inert (same "leave it, don't
  drop it" precedent as `tickets`).
- `resolveLeadToCustomer` (`lib/crm.js`) stops creating an opportunity; quotations/orders link to
  the lead. Repoint the Sales Pipeline / By Department / Agent Performance reports
  (`components/CrmReportPanels.jsx`) to leads.
- Remove the `/pipeline` nav tab (`components/Nav.jsx`); the route redirects to
  `/sales?tab=leads&view=board`. Note for Marketing: they lose that tab too — Marketing-owned
  enquiries still appear in their funnel reports.

**1i. Stage history** — new `lead_stage_history` (lead_id, from_stage, to_stage, changed_by,
changed_at), written wherever `sales_call_status` changes (lead PATCH, Board drag, PO wizard step 1,
Order Lost, Close Sales Call). Enables time-in-stage and win-rate-over-time reports later.

**1j. Duplicate check at conversion** — `resolveLeadToCustomer` currently matches customers by
exact name only. Before creating a customer, show likely matches (normalized name via
`normalizeWords` in `lib/match-utils.js`, plus GST No / phone) and let the user pick one or create
new. Same warning on Add Customer / Add Enquiry.

**1k. GST per line, consistently** — quotation lines take GST % from the product (editable), and
quotations compute CGST+SGST vs IGST with the same `gstSplit()` (`lib/gst-calc.mjs`) the invoices
and PO wizard use, instead of one header GST %. Carries through quote → PO → invoice unchanged.

---

## Phase 2 — Daily usability

**2-0. Own-records visibility + server-side loading** (do first; both change how data is fetched)
- Rule: a Sales member sees a lead/quotation/order where they are the A/C manager, assignee or
  creator (lead → its quotations/orders inherit). `isDepartmentHead(user,'Sales')` and PMs see all.
- Enforced in the data layer and every GET/PATCH route (`app/api/leads/*`, `quotations/*`,
  `sale-orders/*`, `sale-order-payments/*`, `crm-notes`, report data in `app/reports/page.js`), not
  only hidden in the UI. Legacy imported orders with no matching user: Head-only.
- `app/sales/page.js` stops loading every row up front: paged, filtered lists per tab
  (search/stage/manager/date) via API; reports get date-range-bounded server queries instead of
  computing over the whole history in the browser.

**2a. Funnel value & probability** — `sales_stages.probability_pct` (seeded from today's
placeholder formula), editable in a new Masters → Funnel Stages list. Funnel report
(`components/SalesCallReportPanels.jsx`): Value = Σ `expected_value`, Probability (Value) =
Value × %.

**2b. Funnel drill-down** — Sheet becomes a table: customer, short name, address, enquiry date,
contact/mobile, email, product type, stage + latest quote total, expected date, A/C manager, and a
follow-up tooltip reusing `DiarySummaryTooltip`. Customer name links to
`/sales?tab=leads&highlight=LD-{id}` (existing highlight pattern).

**2c. Home calendar overlay** (`components/ProductionToday.jsx`) — follow-ups as a table (SN, Date,
In/Out time, Org, Location, Contact, Objective, Task type, Action taken, Actions). Update Now,
Advanced Update (future date) and New Enquiry open `AddToDiaryDialog` / `AddEnquiryDialog` in place
(export them from `SalesWorkspace.jsx`); Add Expenses unchanged.

**2d. Real alerts** — on Diary save (`app/api/crm-notes/route.js`): "All seniors" →
`notifyDepartmentHeads('Sales')`; "Selected seniors" → `notifyUser` per picked user (new picker);
"Plan of Action for" person gets a notification. SMS select shows "SMS — coming later".

**2e. Quotation follow-up reminders** — a daily run via the existing Cloudflare cron Worker
(`workers/rate-sync-cron/` pattern: new secret-authed endpoint, heartbeat row like
`hub_sync_state`), plus sweep-on-read as a backup (same pattern as `sweepDrawingNotifications`):
sent quotations expiring in ≤3 days, expired with no order, or sent ≥7
days with no Diary activity → `notifyUser` to the owner, `dedupe_key` per quotation+reason. A
"Needs follow-up" badge/filter on the Quotations tab.

**2f. Sales Overview landing panel** — new default `/sales` panel: orders this month vs target,
open funnel value, weighted forecast, today's follow-ups, quotations needing follow-up. Reuse
`components/ReportKit.jsx` (`StatRow`, `BarList`); each tile links to its tab/report. Scoped by 2-0
(a member sees their own numbers, a Head sees the team).

**2g. Mobile** — every new table (calendar overlay, PO items, drill-down, lead products) gets a
card layout below `md`, same pattern as the Projects list.

---

## Phase 3 — Email via Zoho SMTP

- Add `nodemailer`; implement the SMTP branch in `lib/mail.js` (`sendMail({from, to, subject,
  text, html, attachments, credentials})`).
- New `user_mail_credentials` (user_id UNIQUE, email, smtp_host default `smtp.zoho.in`, port 465,
  app_password encrypted with `encryptSecret` from `lib/crypto.js`). GET never returns the secret
  (same rule as `eway_bill_credentials`). "My sending email" card in Settings with Save + Send test.
- Optional company-level fallback sender (e.g. `sales@` mailbox per company) in a sibling table,
  used when the salesperson has none; Reply-To = the salesperson.
- `SendCommercialOfferDialog`: company dropdown (switch re-renders the template and PATCHes
  `quotations.company` so the PDF letterhead matches); PDF attached automatically; sent email logged
  as a CRM note and `quotations.sent_at` set.
- **Check first, before building:** whether the Render host allows outbound SMTP (port 465/587).
  If not, use Zoho ZeptoMail's HTTP API instead — same `lib/mail.js` seam.
- Zoho only lets a mailbox send as itself or its aliases, so From = the authenticated address.
  BCC the sender so the email also appears in their Zoho Sent folder.
- One-password question: Zoho app passwords are per mailbox. A single shared `sales@` mailbox per
  company (Reply-To = salesperson) or Zoho ZeptoMail (one API key, any verified-domain sender) are
  the one-credential options — verify ZeptoMail before choosing; the design supports either.

---

## Phase 4 — 360° CRM

- **Customer 360** sheet: enquiries, diary, quotations, orders, projects, invoices, payments,
  service calls/contracts for one customer (reads existing tables).
- **Competitors**: `customer_competitors` (customer/lead, competitor, product, price, notes);
  Order Lost gains "Lost to competitor".
- **Installed base / Serviceable items**: derived from sale order items + projects with warranty
  dates (`warranty_*_days`, `from_date_of`) → AMC/spares follow-ups; link to `service_contracts`.
- **Quotation revisions** (`parent_quotation_id`, `revision_no` → R1/R2) and Head approval above a
  discount % (new Head-gated action key).
- **Price Lists re-keyed to Product Master** (table rebuild so `item_id` becomes nullable, add
  `product_id`).
- PDF/Excel export for the 13 Sales Call reports.

---

## Phase 5 — Import from the client's current CRM (blocked on an export sample)

Same shape as `scripts/import-sales-tracker.mjs`: dry run by default, `--apply` to write, every row
tagged `created_by='import:legacy-crm-<date>'` for rollback, a data-issues doc for the client
listing everything skipped or unclear. Build each importer against a real export file, not a guess.

Order (each depends on the previous):
1. **Products** → `sales_products` (code, name, type, description, price, unit, HSN, GST %).
2. **Customers & contacts** → match against the existing 334 customers (normalized name, GST No,
   phone) before creating; also re-link the 846 Payment Tracker orders that have only a customer
   name (§5ct).
3. **Open enquiries + diary history** → `leads` + `lead_products` + `crm_notes`; old stages mapped
   to the 9-stage funnel (mapping table reviewed with the client first); A/C manager mapped to users.
4. **Past quotations** → `quotations` + `quotation_items`, marked legacy (no re-numbering into the
   current series), linked to the imported enquiry/customer.

Can start any time after Phase 1 (needs `lead_products`, stage history, lead-linked quotations).

**Later (not planned in detail):** SMS/WhatsApp provider, Product → BOM template UI,
payment-overdue reminders tied to Accounts receipts.

---

## Verification (each phase)

- `npm run lint`; relevant selfchecks (`lib/*-selfcheck.mjs`, add one for any new pure helper, e.g.
  funnel value math).
- Update the Sales (and, where affected, Marketing) guide in
  `components/department-help-content.jsx`; add Head-only action keys for new admin actions
  (stage probabilities, company sender email).
- Live on the dev server as `sales_head`, a Sales **member** login (visibility rule), and
  `marketing_head` (no Sales data leaks),
  using disposable `ZZ-` enquiries/customers/quotations, deleted afterward with a zero-residue check.
- Phase 1 golden path: enquiry with 2 products → Commercial Offer pre-filled → convert → PO wizard
  shows the same lines, derived GST/PAN/SOS fields, correct totals → order PDF → Prospect Summary
  counts the order under the right manager. Board drag changes the stage and writes history; an
  old opportunity's value/items appear on its enquiry after migration; `/pipeline` redirects.
- Phase 2: funnel shows non-zero value; calendar Update Now opens in place; "All seniors" creates a
  bell notification for a Sales head; an expiring quotation notifies its owner once.
- Phase 3: test send with a real Zoho app password; secret never appears in any API response.
