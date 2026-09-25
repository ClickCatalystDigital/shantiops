# Sales CRM — handoff for the next chat (2026-09-25)

Read this first, then `docs/sales-crm-plan.md` (the full phased plan) and `SYSTEM.md` §5db (what is
built, with verification notes). Branch: `claude/exciting-mccarthy-cj760h`.

## Where we are

| Step | Status |
|---|---|
| Phase 1 — enquiry → quotation → PO (1a–1k) | **Done**, verified live, committed |
| Old-CRM data import — Product Master + customer summary | **Done**, applied to the shared DB (see below) |
| **Next: global company selector** (All / Shanti Boilers / Shanti Techno Fab) | Not started — do this first |
| Then: import Techno Fab orders + payment log (client will send files) | Waiting on files |
| Phase 2 — own-records visibility + server-side paging, calendar overlay, real Diary alerts, quotation reminders, mobile cards | Not started |
| Phase 3 — reports: shared layout, CSV/Excel, Employee 360, real funnel, Sales Overview | Not started |
| Phase 4 — Customer 360, competitors, installed base, quotation revisions + discount approval, Price Lists → products | Not started |
| Deferred (not this run) | Zoho email (hosting decision), Marketing workspace, SMS/WhatsApp |

## Decisions already made by the client (don't re-ask)

- Scope is **Sales only**; Marketing later. `/sales` holds daily work only; analysis lives in Reports
  (charts + details table + CSV/Excel).
- The **9-stage funnel is the only status**; the **enquiry is the deal** (no Opportunities for Sales).
- Visibility (Phase 2a): a member sees own records; Sales Head and PMs see all.
- In-app alerts now; SMS/WhatsApp later. Entity Code = `company_settings.invoice_prefix` (confirmed).
- Product Master = what the company sells (quote/PO lines); Item Master = what products are built from.

## Company selector — what to build next

- One dropdown (All / Shanti Boilers / Shanti Techno Fab) in the Sales area, remembered per user
  (URL `?company=` + localStorage), filtering the lists that already carry `company`:
  `sale_orders.company`, `quotations.company`, `sales_invoices.company`, and payments via their
  sale order. Company names come from `lib/company-profiles.js` `COMPANY_NAMES`.
- Customers and products are **shared across both companies** (a party can buy from either) — don't
  filter them.
- New Sale Orders / quotations should default to the selected company (not "All").
- The 1,006 existing imported orders are all `company = 'Shanti Boilers'`. Techno Fab orders +
  payments come next; reuse `scripts/import-sales-tracker.mjs` as the pattern (dry run → `--apply`,
  tag rows for rollback, new tag name, `COMPANY = 'Shanti Techno Fab'`).

## Old-CRM import (done 2026-09-25)

- Script: `scripts/import-legacy-crm.mjs` (parser `lib/legacy-crm-import.mjs` + selfcheck).
  Rollback: `node scripts/import-legacy-crm.mjs --rollback` with
  `IMPORT_MANIFEST=scripts/data/legacy-crm-import-manifest.json` (restores the 119 existing
  customers' blank fields, deletes rows tagged `import:legacy-crm-2026-09-25`). Rollback was proven
  on a 600-row slice (tables byte-identical to the backup) before the full run.
- Result: 1,826 products; 8,971 summary rows → 8,847 organizations → 8,728 new customers + 119
  existing filled in (blank fields only); customers now 9,068. 16 test rows skipped, 1 unreadable
  row. Client-facing issues: `docs/legacy-crm-import-issues.md`,
  `docs/legacy-crm-possible-duplicates.csv` (1,315 same-name orgs kept apart — for the client to review).
- GST 0% on 983 products was imported as blank (quotes then use the Default GST %) — client to confirm
  which are really exempt. The customer export is a per-organization summary, so **no enquiries were
  created**; it's shown on the customer sheet as "From the old CRM".
- Phase 5 (enquiry-level history import) still needs a real enquiry/diary export from the old CRM.

## Ground rules (the client asked for these)

- The shared Turso DB is **production**. Before any data change: back up the affected tables, prove
  rollback, dry run, then apply. Test rows are `ZZ-` prefixed, deleted after, zero-residue check,
  counters restored (`quotation_no` 30, `sale_order_no` 27, `invoice_no:Shanti Boilers:2026-27` 36
  at last check).
- Never write Turso credentials into files; they're in the environment.
- Additive schema only (`addColumn()` in `lib/db.js` `migrate()`); one commit per step; update
  SYSTEM.md §5db + the Sales help guide (`components/department-help-content.jsx`) each step.
- Keep it lean — the client is cost-conscious. Don't over-populate `/sales`.

## Practical notes

- Dev server: `npx next dev -p 3000`; logins `sales_head`/`sales_head123`, `admin`/`admin123`.
- The first request after a `lib/db.js` change takes ~5 min (migrate over the network). For a new
  column you need right away, run the `ALTER TABLE … ADD COLUMN` directly (migrate skips existing
  columns) — that's what the old-CRM import did.
- `/sales` still loads everything server-side (1,006 orders, now ~9k customers) — Phase 2a fixes this
  with paged API loading. Customers/Products tabs got client-side search + paging meanwhile.
- Pure helpers with selfchecks (`node lib/<name>-selfcheck.mjs`): `sales-lines`, `sales-people`,
  `customer-match`, `lead-stage`, `legacy-crm-import`, `gst-calc`.
- Open question for the client: the PO wizard screen was verified through its API, not clicked in
  a browser — worth a quick manual look.
