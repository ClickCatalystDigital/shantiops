# V3 — 360° Platform (ERPNext back-office + Executive 360)

Working spec, same convention as `PROCUREMENT-CHANGES.md` / `QC-CHANGES.md` / V2: this is the
build plan; it folds into `SYSTEM.md` when done, then stays as the historical record. Read this
first if picking up V3 cold. Written for me / future-me, not the client.

The whole architecture came out of a long risk analysis (prior chat). If a decision here looks
arbitrary, it isn't — it's the conclusion of that analysis. The five load-bearing conclusions are
the **invariants in §2**; violating one is the only way this project fails badly.

---

## 0. Goal & the one decision already made

Make Shanti Ops present a **360° business view** and mature the back-office (Finance/GST, HR,
Payroll, CRM, Sales & Marketing) — **without merging databases and without rebuilding ERPNext's UI
in Next.js.**

Decision (final): **ERPNext runs as a SEPARATE system** — its own MariaDB, its own native UI, used
by a **small back-office group** directly. Shanti Ops stays the operational product and primary UI.
The two meet at a **thin API seam** plus a **snapshot table the 360 dashboard reads**. No shared DB,
no two-way sync engine, no replicated ERP DB, no SSO (yet).

> "One connected business platform does NOT mean one database."

---

## 1. Two tracks — this sequencing IS the plan

- **Track A — buildable NOW, needs no ERPNext.** Makes the system "360-ready" and demoable entirely
  on our own Turso data. This is what we finish quickly.
- **Track B — needs an ERPNext instance stood up.** Makes Finance/HR/Payroll *real*.

A is deliberately designed so that **B swaps the data source behind ONE table (`erp_snapshot`) and
changes nothing in the UI.** Finance/HR tiles read `erp_snapshot` from day one; today it's seeded
with demo numbers, later it's populated from ERPNext. Same interface, so Track A is not throwaway.

Ponytail note: we are **not** building the outbox / integration_log / push code in Track A — there's
nothing to push to yet. Those are Track B, gated on ERPNext existing. Building them now is
speculation.

---

## 2. Invariants — do NOT violate these in any V3 work

1. **System-of-record (SoR):** operational/physical = Shanti Ops; commercial/financial = ERPNext
   (once live). Full table in §7. Every object has exactly one owner.
2. **ERPNext Stock module stays OFF.** Inventory is Shanti Ops's (`inventory_items` +
   `inventory_reservations`, SYSTEM.md §5e). Never track stock in both — that's double-truth /
   overselling.
3. **Item master is SPLIT.** Only traded/finished/stocked goods become ERPNext Items (they need
   HSN/GST on an invoice). Engineering BOM lines **stay free-text in `bom_items`** — never master
   thousands of one-off boiler-BOM lines in ERPNext. We already have an `items` catalog (2,773 STERP
   rows, `lib/db.js` ~852, HSN present) — that's the seed for the *traded/stocked* subset, not for
   BOM lines.
4. **Finance rule: CONSUME, never RECOMPUTE.** Shanti Ops stores ERPNext's computed values
   (outstanding, paid, invoice totals) verbatim. Zero financial arithmetic in Ops. The moment Ops
   sums line items itself, its dashboard disagrees with the books and executives lose trust.
   **Amended §12 (2026-08-10): this rule now covers Finance and statutory Payroll only.** HR
   (employees/attendance/leave/shifts/recruitment) went native in §12 and is real Shanti Ops data,
   not `erp_snapshot`-sourced — the original wording covering "Finance/HR" was written before that
   decision existed.
5. **360 dashboard reads a snapshot, never queries ERPNext live per page load** — for the
   Finance/Payroll tiles that still are ERPNext-sourced. Degrades to last-known snapshot + a
   staleness badge if ERPNext is down.
6. **Offboarding is one action (Track B):** deactivating an Ops user must also disable the ERPNext
   user (API) **and** flag the device-agent machine (SYSTEM.md Part B) for revocation. Three
   surfaces, one trigger. This is the reason deferring SSO is safe.

---

## 3. Assumptions

- **Back-office ERPNext users are few** (accountants/HR/sales-office) and use ERPNext's own UI. So:
  no SSO in v1, separate logins acceptable, no rebuilding finance/HR/CRM screens in Next.js.
- **Volume is human-paced** — tens of documents/day, not thousands. This deletes almost all
  enterprise consistency machinery (no event bus, no Kafka, no CDC, no saga).
- **We already own most master data natively:** `customers` (party master, `lib/db.js` ~819),
  `suppliers` (with full GST fields incl. `state_code`, ~471), `items` (catalog+HSN, ~852),
  `sale_orders` (free-text, ~890). Track A builds on these; Track B decides which become
  ERPNext-mastered.
- **ERPNext hosting = self-hosted on Render (RESOLVED 2026-08-10, supersedes the earlier Frappe
  Cloud recommendation from the risk-analysis discussion)** — explicit call to avoid Frappe Cloud's
  subscription cost, accepting the ongoing ops burden (MariaDB backups/restores/upgrades, Redis,
  workers, scheduler) in exchange. Verified against the real official architecture, not assumed:
  - **The blocker:** the official `frappe_docker` multi-container split (`frontend`/`backend`/
    `websocket`/`queue-short`/`queue-long`/`scheduler` as separate containers) requires a shared
    ReadWriteMany `sites` volume across all of them (Frappe's own Helm chart mandates NFS/EFS-class
    storage for exactly this). Render persistent disks are single-instance-only, never shared across
    services — the official split cannot run on Render unmodified.
  - **The fix (validated precedent, not invented):** bundle frontend/backend/websocket/both queue
    workers/scheduler into **one** container via supervisord, sharing one Render disk because
    they're one process group — the same pattern Frappe's own official Railway deploy template uses
    to solve Railway's identical one-disk-per-service constraint.
  - **Render services:** `erpnext-app` (Private Service + disk, supervisord-managed bundle above),
    `erpnext-db` (Private Service + disk, `mariadb:11.8` — the exact image the official
    `compose.mariadb.yaml` override uses), two Render Key Value instances (managed Redis-compatible
    — `allkeys-lru`/no-persistence for cache, `noeviction`/persistence for queue, per Render's own
    documented recommendation) in place of self-hosted Redis containers, and an `erpnext-backup`
    Cron Job running the official `bench --site all backup --with-files` on a schedule, pushed to S3
    (reuse the existing `@aws-sdk/client-s3` dependency/pattern already in this repo) — **not**
    Render's disk-snapshot feature, which Render's own docs warn against for live databases.
  - **Sizing to start:** `erpnext-app` + `erpnext-db` at Standard (2GB/1CPU, $25/mo each), Key Value
    ×2 at Starter ($10/mo each), Cron Job (~$1–5/mo), ~40GB combined disk (~$10/mo) — roughly
    **$85/month floor** for a small back-office team; cheap to move `erpnext-app` up to Pro later,
    can't move disks down.
  - **Known trade-offs, stated not hidden:** no zero-downtime deploys once a disk is attached (Render
    stops the old instance before starting the new one); no horizontal scaling of `erpnext-app`/
    `erpnext-db` (single-instance by Render's disk design); the supervisord bundle means a
    container-level restart takes backend+websocket+workers+scheduler down together, not just one
    process — less isolated than the official split, the real cost of the blocker fix. All acceptable
    at this scale; revisit if the back-office team grows substantially.
  - **Not yet provisioned** — this is the verified plan, not a deployed instance. Next real step
    (when ready) is producing the actual Dockerfile/supervisord.conf/entrypoint/`render.yaml`, then
    provisioning via the Render dashboard — a separate, explicit go-ahead from just planning it.
- **Sales Order direction (default assumption, changeable — see §9):** for now Shanti Ops keeps
  owning `sale_orders`. When ERPNext CRM goes live, the SO may be born there instead and Ops
  references it. Track A does not depend on which way this resolves.
- **Executive 360 = extend the EXISTING Executive view** (`app/executive/page.js` +
  `components/PortfolioDelayTimeline.jsx`), not a new page. "Integrate with what we have."

---

## 4. Deferrals — DO NOT BUILD NOW

- Full/two-way DB sync · universal event bus · Kafka · replicated ERP DB · duplicate ERP UI in
  Next.js · microservices · data warehouse · custom accounting/payroll engine · cross-app permission
  sync · bi-directional inventory → **DO NOT BUILD, any track.**
- SSO · webhooks (poll instead) · outbox/integration_log/push code · real ERPNext Items migration ·
  PO→ERPNext push → **LATER (Track B), not now.**
- Full CRM (lead scoring, campaigns, marketing automation) → **LATER.** Track A gets a *light*
  pipeline only (§5, A4), and only if we decide the pipeline tile must be real vs. order-backed.

---

## 5. Track A — build now (no ERPNext)

### A1 — Marketing department (the specific gap the user flagged)
Marketing is missing from `DEPARTMENTS`, d-login, seed. Add it exactly like **Sales** (a
no-milestone department — same precedent as Engineering/Stores/Sales; it gets the generic
Home/Operations/Projects shell + access-matrix + nav for free). Concretely:
- `lib/milestones.js:11` — append `'Marketing'` to `DEPARTMENTS`.
- `lib/db.js` `HEAD_USERS` (~1090) — add `marketing_head: 'Marketing'`; mirror the `sales_head`
  seed block (~944) so a fresh-and-idempotent `marketing_head` / `marketing_head123` operator is
  created (guard on `SELECT 1 ... WHERE username='marketing_head'`, same as sales_head).
- `app/d-login/page.js` `DEMO_GROUPS` Department Heads list — add `'marketing_head'`.
- No milestones, no new schema. Access matrix / nav / Home all pick it up from `DEPARTMENTS`.

Decision taken: Marketing is its **own department**, not folded into Sales — cheapest consistent
move, and keeps "Sales & Marketing" as two scoped units. Sales + Marketing **share** the CRM/
pipeline surface (A4).

### A2 — Executive 360 dashboard (extend `app/executive/page.js`)
Existing Executive view already has ops KPIs + the portfolio milestone tracker (SYSTEM.md §4). Add
the missing 360 pillars as tiles, each labeled with its **source + freshness**:
- **Native/live (we own the data):** Sales pipeline (from A4 or `sale_orders`), Active orders,
  Project progress, BOM completion, Procurement flow (reuse `ProcurementFlow.jsx` /
  `getProcurementFlowCounts`), Supplier performance (from quotes/PO/QC history), Production, QC,
  Dispatch. These read Turso directly.
- **Snapshot-backed (A3):** Receivables, Cash / invoice status, HR summary, Payroll summary. These
  read **only** `erp_snapshot`. Today: seeded demo numbers, clearly badged "as of <ts>". Later:
  ERPNext (Track B) — no UI change.
- Every financial/HR tile shows one shared "as of HH:MM" timestamp so numbers are never mixed
  across freshness.

### A3 — `erp_snapshot` seam table (the whole point of A being non-throwaway)
```
erp_snapshot (
  id, metric_key TEXT, scope TEXT,        -- e.g. metric_key='ar_outstanding', scope='ALL' or project_no
  value_num REAL, value_text TEXT,
  source TEXT,                            -- 'demo' now, 'erpnext' later
  as_of DATETIME, updated_at DATETIME,
  UNIQUE(metric_key, scope)
)
```
- Add via `addColumn`/`CREATE TABLE IF NOT EXISTS` in `lib/db.js migrate()`, same as every other
  table. Seed a demo row per finance/HR tile in `seedIfEmpty`, `source='demo'`.
- One reader helper in `lib/data.js` (`getSnapshot(metric_key, scope)`), used by A2's tiles.
- Track B just changes who WRITES this table (a scheduled pull from ERPNext), never who reads it.

### A4 — Light Sales/Marketing pipeline (COMMITTED — decided 2026-08-10)
To make the "Sales Pipeline" tile real rather than order-count-only. Minimal, on top of existing
`customers`:
```
opportunities (
  id, customer_id INTEGER REFERENCES customers(id), title TEXT,
  stage TEXT,           -- Lead | Qualified | Quoted | Won | Lost
  value_num REAL, probability INTEGER, expected_close DATE,
  owner_dept TEXT,      -- 'Sales' | 'Marketing'
  created_by, created_at, updated_at
)
```
- One workspace shared by Sales + Marketing (extend `components/SalesWorkspace.jsx` or a sibling
  `PipelineWorkspace.jsx`), Kanban by `stage` (reuse the native HTML5 DnD pattern from
  `StagesPanel.jsx` — no library).
- **This is the one Track-A piece that overlaps ERPNext CRM.** Kept native because ERPNext isn't up
  and it's cheap; flagged in §9 as a migrate-or-keep decision when ERPNext CRM goes live. If we'd
  rather not risk that overlap, skip A4 and let the pipeline tile show order counts from
  `sale_orders` for now.

---

## 6. Track B — build when ERPNext exists

Gated on an ERPNext (Frappe Cloud) instance + service account. Then, in order:
1. **Stand up ERPNext**, Finance + Payroll first (GST/HSN, chart of accounts, payroll rules). Stock
   module OFF. Back-office uses it directly. Zero integration day one.
2. **`erp_snapshot` writer:** scheduled pull (15–60 min) of ERPNext's *computed* AR/cash/HR/payroll
   summaries → `erp_snapshot`, `source='erpnext'`. Flip A2's tiles from demo to live by data alone.
3. **Seam #1 (SO in):** on ERPNext SO submit → create/attach the Shanti Ops project. (Only if SO
   direction resolves to ERPNext-owns — §9.)
4. **Seam #2 (dispatch → invoice out):** Ops dispatch confirmed → create ERPNext Delivery Note +
   Sales Invoice, via a **transactional outbox** (`integration_outbox` written in the same Turso txn
   as the dispatch) + **idempotency key = Ops document number** stored in an ERPNext custom field
   `shanti_ref`. Retry worker; failures park as `failed` in an admin view.
5. **`integration_log`** (also the audit trail): ts, actor, source_system, action, doctype,
   local_id, external_id, status, error. Reuse the `usb_audit` philosophy.
6. **External-ID columns** on Ops rows (`erp_customer_id`, `erp_so_id`, `erp_invoice_id`, …) — add
   only for the entities a seam actually touches.
7. **Offboarding trigger** (invariant §2.6): extend the existing Ops user-deactivate to also call
   ERPNext disable-user + flag the device machine.
8. **Reconciliation script:** nightly/on-demand, compares external IDs both ways; the DR
   split-brain recovery tool too.

Enterprise machinery still **not** built even in B: event bus, Kafka, real-time sync, warehouse.
Poll + outbox is enough at this volume.

---

## 7. System-of-record table (the contract)

| Object | Owner | Notes |
|---|---|---|
| Customer / Contact / Lead / Opportunity | **ERPNext** (once CRM live); **Ops now** (A4/`customers`) | migrate decision §9 |
| Sales Order | **ERPNext** (target) / **Ops now** (`sale_orders`) | direction decision §9 |
| Project / Boiler order | **Shanti Ops** | ERPNext references as cost dimension |
| BOM / BOM item | **Shanti Ops** (exclusive) | never in ERPNext |
| Item master | **SPLIT** | traded/stocked→ERPNext (HSN); BOM lines→Ops free-text |
| Supplier | **ERPNext** (once AP live), Ops caches | migrate `suppliers` at Track B |
| Supplier quotation | **Shanti Ops** | sourcing IP |
| Purchase Order | **Shanti Ops** (operational), ref to ERPNext | |
| Purchase/Sales Invoice, Payment | **ERPNext** | Ops reads status only (consume, §2.4) |
| Inventory / stock | **Shanti Ops** | ERPNext Stock OFF |
| Production / QC / Certificate / Dispatch | **Shanti Ops** | Ops IP; dispatch triggers invoice |
| Employee / Leave / Attendance / Payroll | **ERPNext HR** | Ops links by `erp_employee_id` |
| User / login | **each system owns its own** | linked for offboarding only |
| Department | **each owns its own taxonomy** | ops-workflow depts ≠ HR/accounting depts — do NOT sync |
| Vendor rating | **Shanti Ops** (derived) | |

---

## 8. Marketing / d-login / departments — resolution (the specific ask)

- Current `DEPARTMENTS` (`lib/milestones.js:11`): Design, Engineering, Procurement, Stores,
  Production, QC, Dispatch, Installation, **Sales**. **Marketing missing** — that's the whole gap.
- Fix = A1 above: add Marketing as a no-milestone department + `marketing_head` demo user +
  d-login entry. Slots into all existing machinery (access matrix, nav, Home) with **no new
  concepts and no milestone changes.**
- d-login password is `dem` (`app/d-login/page.js` DemoGate) — unchanged; just add the new head to
  the Department Heads group so it appears in the picker.
- We already have the CRM-adjacent master data (`customers`, `sale_orders`, `items` w/ HSN,
  `suppliers` w/ GST) — Marketing + Sales share the A4 pipeline over `customers`; nothing here needs
  ERPNext to demo.

---

## 9. Open decisions (answer before the dependent phase; none block A1–A3)

1. ~~A4 — build the light pipeline now, or defer?~~ **RESOLVED 2026-08-10: build it now.** Only
   remaining downstream call is migrate-vs-keep when ERPNext CRM goes live (Track B).
2. **Sales Order direction** — when ERPNext CRM goes live, does the SO originate in ERPNext (Ops
   references) or stay Ops-owned (push to ERPNext for invoicing)? Decides Seam #1 vs #2 emphasis.
   Not needed until Track B.
3. **Supplier/Customer master migration** — at Track B, do `suppliers`/`customers` become
   ERPNext-mastered (Ops caches) or stay Ops-owned with ERPNext referencing? Affects one-time
   reconciliation only.
4. ~~ERPNext hosting — Frappe Cloud vs self-host?~~ **RESOLVED 2026-08-10: self-hosted on Render.**
   Full architecture verified and recorded in §3. Track B gate remains — no code depends on it yet;
   next step is producing the deployable config (Dockerfile/supervisord/entrypoint/`render.yaml`),
   pending explicit go-ahead.

---

## 10. Definition of done (Track A)
Marketing department live end-to-end (login, nav, access matrix, Home) · Executive view shows all
360 pillars with source/freshness badges · finance/HR tiles read `erp_snapshot` (demo-sourced,
badged) · (if A4) Sales+Marketing pipeline Kanban over `customers`. All verified live on the dev
DB (note: dev writes the **shared remote Turso**, per memory — seed guards must stay idempotent).

---

## 11. Track A — STATUS: BUILT & VERIFIED (2026-08-10)

All of A1–A4 implemented, `npm run build` clean, verified live on the dev server (shared Turso).

**Files touched:**
- `lib/milestones.js` — `Marketing` added to `DEPARTMENTS`.
- `lib/db.js` — `erp_snapshot` + `opportunities` tables (`CREATE TABLE IF NOT EXISTS`);
  `marketing_head` added to `HEAD_USERS` + guarded one-off seed insert (mirrors `sales_head`'s
  existing idempotent pattern exactly); new `seedV3DemoData()` seeds 6 snapshot metrics
  (`source='demo'`) + 5 demo opportunities, each guarded on its own table's row count.
- `lib/data.js` — `getErpSnapshot(scope)`, `getOpportunities()`, `getOpportunityPipelineCounts()`.
- `app/api/opportunities/route.js`, `app/api/opportunities/[id]/route.js` — GET/POST/PATCH, gated
  to Sales-or-Marketing (mirrors `app/api/bom-items/[id]/cancel`'s two-department pattern).
- `app/pipeline/page.js`, `components/PipelineWorkspace.jsx` — Kanban board, native HTML5
  drag-and-drop (StagesPanel.jsx pattern), add-dialog (SalesWorkspace.jsx pattern).
- `components/Nav.jsx` — `Pipeline` tab, shown to Sales OR Marketing heads.
- `app/executive/page.js` — Sales Pipeline tile (live), Procurement tile (reused
  `<ProcurementFlow>` as-is, zero new code), Finance & HR tile row (snapshot-backed, badged).
- `app/d-login/page.js` — `marketing_head` added to the demo picker.
- `.env.local` (local dev only, not seed logic) — `marketing_head` added to `DEMO_USERS`.

**Verified live (browser + curl against the dev server):**
- `marketing_head` / `marketing_head123` logs in via `/d-login` (password `dem`), lands on
  Operations scoped to Marketing, empty state correct (no milestones, by design).
- Access Matrix (`/settings`) auto-picked up the `Marketing` column and `marketing_head` row —
  zero code beyond `DEPARTMENTS`/`HEAD_USERS` was needed.
- `/pipeline`: Kanban renders 5 seeded opportunities correctly grouped by stage; "New Opportunity"
  dialog correctly hides the owner-department picker for a single-department head and defaults it
  server-side; POST creates a row with the right `owner_dept`; PATCH moves stage (tested both via
  UI-triggered POST and direct curl PATCH, including a rejected invalid-stage value); a QC-only
  head is correctly 403'd from POST.
- `/executive` (as PM): Sales Pipeline tile shows live counts/value; Procurement tile is the
  existing `ProcurementFlow` component reused verbatim; Finance & HR tile shows all 6 snapshot
  metrics with a single shared "As of <timestamp> · Demo data" badge (invariant §2.4/§2.5 held —
  nothing recomputed, one freshness badge per row).
- No server errors in dev logs across the full session; production build clean (no new
  errors/warnings).

**Non-blocking gaps found — documented, not fixed (none block Track A or contradict an invariant):**
1. **PM nav gap, pre-existing, not introduced by V3:** the PM top-nav (`Nav.jsx`'s `isPMUser`
   branch) is a fixed 4-item list (Executive/Operations/Projects/Approvals) with no department
   tabs — so a PM has no nav link to `/pipeline`, exactly as they already have none to `/sales`.
   The page itself is reachable (`canAccessDepartment` passes for any PM) and works if navigated
   to directly; only the nav *link* is missing. Same shape as the existing Sales gap — not a
   regression, just not fixed either. Worth a look whenever the PM nav is revisited generally.
2. **A4 pipeline overlaps ERPNext CRM's future job**, as flagged in A4 itself and open decision
   §9.1 — a deliberate, called-out overlap, not an oversight. Migrate-or-keep call deferred to
   Track B.
3. **One smoke-test opportunity row** (`marketing_head`, "V3 smoke test opportunity") was created
   during verification via the real UI, then stage-moved via curl to confirm PATCH. Left in place
   — harmless, clearly labeled, and there's no delete route for `opportunities` (matching
   `sale_orders`' own append-only precedent) so removing it would mean either a raw SQL delete
   outside the app's own idiom or adding a DELETE endpoint neither the spec nor any current need
   asks for. Fine to delete by hand later if it's ever noticed as clutter.
4. **`erp_snapshot`/`opportunities` have no admin edit UI** — by design (Track A scope was read
   surfaces + the pipeline's own CRUD, not a snapshot-editing tool; nothing in Track A needs one).
   Flag if a real need for manually correcting a demo metric shows up before Track B exists.

---

## 12. PRODUCT DECISION: Accounting/statutory finance DEFERRED; CRM+Selling+HR built to real depth (2026-08-10)

**DO NOT REOPEN THIS DECISION.** Read this section before touching anything CRM/Selling/HR/Finance
shaped. Full plan lived at `/Users/pujan/.claude/plans/we-have-made-an-cached-sunrise.md` during
the build — implementation record below is the permanent home once done.

### The decision

Shanti Ops will **not** build a regulated accounting/compliance engine. Deferred, permanently,
ERPNext-integration territory, an **option not a dependency**:

General Ledger · double-entry accounting engine · Chart of Accounts · Journal Entries ·
Accounts Receivable/Payable accounting logic · GST calculation engine · GST returns/filing ·
E-invoicing/IRN · E-way Bill · TDS calculation/filing · statutory payroll calculations ·
PF/ESI/Professional Tax · income-tax payroll calculations · financial period closing · financial
reconciliation engine.

**Extended to five doctypes that live in the HR/Selling apps but carry financial posting** —
excluded for the identical reason: **Expense Claim, Employee Advance** (post to GL);
**Overtime Slip/Type** (feeds payroll); **Proforma Invoice, Customer Credit Limit** (financial
controls). If a future change starts needing a tax rule, a ledger entry, or a salary calculation —
stop. That is this deferred layer, regardless of which module it nominally sits in.

**Finance is not deleted from the 360° vision** — only its regulated implementation is deferred.
`erp_snapshot` (§3/A3) remains the seam a future accounting system connects through with no UI
rebuild.

### What's native instead — built to real ERPNext feature depth, not a thin approximation

Scope was corrected twice during planning: first from "roughly 10% of ERPNext's non-accounting
doctype surface" (measured against ERPNext's + HRMS's real source — 534 + 159 = 693 doctypes) to
"match non-accounting depth precisely," then scoped feature-by-feature against the real `crm`,
`selling`, `hr` doctype lists. Result, explicitly named so a future session doesn't assume these
are still thin or still deferred:

- **CRM**: Lead as a real entity (not a pipeline stage) with qualify→convert to Customer +
  Opportunity; Opportunity line items; Campaigns; a shared activity/notes log; DB-configurable
  sales stages.
- **Selling**: Customers/Contacts/Addresses activated; Quotation → Sale Order (real line items) →
  Project, full chain.
- **HR**: unified `employees` master (absorbing the old Production-only `workers`); Attendance;
  Leave with real balances + holiday calendar; Shifts; checklist-driven Onboarding/Separation.
- **Recruitment**: a full ATS (Openings → Applicants → Interviews → Offers → Hire-to-Employee).

**Explicitly scoped and deferred, not overlooked** (a future session should not "discover" these
as gaps and build them without a fresh decision): Performance reviews (appraisals/goals/KRAs),
Training/Skills, Grievance case management — each is its own standalone subsystem, deferred by an
explicit choice during scoping, not an oversight.

Also **not built**: `docstatus`/submit-immutable-cancel-amend (ERPNext's largest remaining
structural mechanism vs. Shanti Ops — deliberately not generalized, a "generic ERP abstraction
layer" the product decision explicitly bans); Territory/Customer Group/Sales Partner/Product
Bundle/Installation Note (Installation is already a Shanti Ops department/milestone — likely
redundant, not a real gap); Warranty/AMC (unrelated next phase, already agreed separately).

### Capability matrix

| Capability | Owner | Status | Future |
|---|---|---|---|
| CRM (Lead/Opportunity/Campaign) | Shanti Ops | Native | — |
| Selling (Quotation/Sale Order) | Shanti Ops | Native | — |
| HR — Employee Master | Shanti Ops | Native | — |
| HR — Attendance/Leave | Shanti Ops | Native | — |
| HR — Shifts | Shanti Ops | Native | — |
| HR — Onboarding/Separation | Shanti Ops | Native | — |
| Recruitment (ATS) | Shanti Ops | Native | — |
| Master BOM | Shanti Ops | Native (ahead of ERPNext) | — |
| Procurement (RFQ→quote→PO) | Shanti Ops | Native (ahead of ERPNext) | — |
| QC / Statutory Certificates | Shanti Ops | Native (ahead of ERPNext) | — |
| Dispatch / Packing | Shanti Ops | Native (ahead of ERPNext) | — |
| Stores / Inventory | Shanti Ops | Native | — |
| Device security (Part B) | Shanti Ops | Native (unrelated to ERP) | — |
| Accounting (GL, CoA, journals) | Deferred | Not building | ERPNext / future |
| GST (calc, returns, e-invoice, e-way bill) | Deferred | Not building | ERPNext / future |
| TDS | Deferred | Not building | ERPNext / future |
| Statutory Payroll (PF/ESI/PT/income-tax) | Deferred | Not building | ERPNext / future |
| Expense Claims / Advances / Overtime | Deferred | Not building | ERPNext / future |
| Performance Reviews | Deferred (scoped, not overlooked) | Not building | Later phase |
| Training / Skills | Deferred (scoped, not overlooked) | Not building | Later phase |
| Grievance case management | Deferred (scoped, not overlooked) | Not building | Later phase |
| Warranty / AMC | Deferred (unrelated) | Not building | Next phase |

### Implementation record — STATUS: BUILT & VERIFIED (2026-08-10)

All five phases (0 docs, 1 CRM, 2 Selling, 3 HR core, 4 Recruitment, 5 Executive) implemented per
the approved plan, `npm run build` clean, full chain verified live via curl + direct DB assertions
against the shared Turso DB, plus a browser pass on `/hr`, `/sales`, `/pipeline`, `/executive`.

**New tables:** `leads`, `campaigns`, `opportunity_items`, `crm_notes`, `sales_stages`,
`contacts`, `addresses`, `quotations`, `quotation_items`, `sale_order_items`, `designations`,
`employment_types`, `employees`, `attendance_days`, `leave_types`, `leave_allocations`,
`leave_requests`, `holidays`, `shift_types`, `shift_assignments`, `employee_onboarding`,
`onboarding_tasks`, `employee_separation`, `separation_tasks`, `job_openings`, `job_applicants`,
`interviews`, `job_offers`. Additive columns on `opportunities`, `sale_orders`, `projects`.
`workers`/`worker_days` retired (decision 1) — not dropped, `WorkersPanel.jsx` re-pointed to
`employees`/`attendance_days`, Production-only gate unchanged.

**~35 new API routes**, `lib/hr.js` (leave balance — computed, never stored; working-days math;
the shared employee+onboarding creation playbook used by both direct hire and Recruitment hire),
`lib/quotation-pdf.js` (mirrors `lib/po-pdf.js`), `HrWorkspace.jsx`, and `SalesWorkspace.jsx`
rebuilt as tabbed workspaces. `PipelineWorkspace.jsx`, `NewProjectForm.jsx`, `app/executive/page.js`
extended.

**Full chain verified end-to-end (curl + DB assertions):**
Lead → convert (Customer+Opportunity, `customer_id` FK — previously dead, now populated) →
opportunity line items → note → Won → Quotation (PDF renders, valid single-page document) →
accept → convert to Sale Order (lines copied, `customer_id`/`opportunity_id`/`quotation_id` all
set) → create Project (`customer_id`/`sale_order_id` set, `customer_name` NOT NULL still honored).
Employee → shift → attendance → leave allocation → in-balance request approved → over-balance
request correctly **rejected at 409** (computed balance, not a stored counter) → onboarding
auto-seeded (6 tasks). Recruitment: Opening → Applicant → Interview → hire → auto-created
`employees` row + onboarding (same playbook as the CRM conversions — 4th use).

**Two real bugs found and fixed during verification, not just the happy path:**
1. **Timezone off-by-one (data integrity):** the leave-approval route and `lib/hr.js`'s
   working-days loop used `.toISOString().slice(0,10)` to stamp `attendance_days` dates — this
   codebase's own documented IST gotcha (`lib/date.js`'s comment block, SYSTEM.md §18). Under IST
   (UTC+5:30) this shifted every stamped date back by one day (confirmed live: a 17–19 Aug leave
   request stamped 16–18 Aug). Fixed by switching both call sites to the existing `toISODate()`
   helper instead of raw `.toISOString()`; re-verified correct (17–19 Aug stamped exactly).
2. **Tab layout bug (cosmetic, but real):** `HrWorkspace.jsx`/`SalesWorkspace.jsx` omitted the
   `flex-col`/`variant="line"` classes the established `ProcurementWorkspace.jsx` pattern requires
   on `<Tabs>`/`<TabsList>` — tabs rendered as a broken sidebar column instead of a horizontal row.
   Fixed in both files, confirmed visually.

**Non-blocking gaps found — documented, not fixed:**
- No manage-UI for `sales_stages` (PM-only stage add/reorder) — the table is DB-configurable and
  seeded correctly with 5 defaults; only the admin UI to add a 6th is missing.
- Job offers have no dedicated UI panel in the Recruitment Kanban (the `job_offers` table + API
  exist; hiring doesn't require an offer record to exist first, so this doesn't block the flow).
- Rate/amount input fields in the two line-item editors were initially too narrow for 7-digit
  rupee values (data stored correctly throughout; purely a display clipping issue) — widened.
- Employee detail Sheet's line-item/notes fetch has a brief loading flash (data arrives ~1s after
  open) — no loading skeleton shown; cosmetic only.

**All smoke-test data created during verification was cleaned up** from the shared Turso DB
(leads/customers/opportunities/quotations/sale_orders/projects/employees/job openings/etc. created
during this session's testing) — confirmed `suppliers` still 445, `projects` back to 6 (5 real +
sentinel), `opportunities` back to the original 5 seeded demo rows. One harmless real-employee
attendance mark (from interactive browser testing on Design Head) was left in place, matching the
precedent from the earlier Track A verification round.

**Nothing found that contradicted an invariant, corrupted/duplicated data, broke an existing
workflow, or raised an unresolved authorization concern** — the two bugs above were found and
fixed during verification itself, not left as open blockers.

---

## 13. HR field-depth gap closure — STATUS: BUILT & VERIFIED (2026-08-10)

**Trigger:** after §12 shipped, a field-by-field audit against the real `Employee`
(`erpnext/setup/doctype/employee/employee.json`), `Attendance`, and `Leave Application` doctypes
(fetched live from `frappe/erpnext` and `frappe/hrms` source, not from memory) found real gaps —
address, emergency contact, manager/org-chart, joining-lifecycle dates, exit structure, attendance
punch times, leave half-day/approver. **Explicit correction to how §12 was scoped:** those fields
were left out on my own judgment about priority, not because the user asked for a thinner build.
**Standing rule going forward: do not omit a field from a module we ARE building without asking
first.** The only fields that stay excluded are the ones inside the HARD BOUNDARY (§ above) —
accounting/GST/TDS/statutory-payroll *calculations and postings*. A field that only **stores** a
value (a bank account number, a CTC figure) is not a calculation and is not covered by that
boundary — same precedent `quotations.tax_pct` already sets (a stored value, zero engine behind
it). Salary/bank fields below are added on that basis: reference data only, never computed, never
posted, never fed into a payroll run.

### Additive columns — `employees`

```
gender TEXT
date_of_birth DATE
photo_url TEXT
reports_to INTEGER REFERENCES employees(id)   -- manager / org chart; also the default leave approver
current_address TEXT
permanent_address TEXT
emergency_contact_name TEXT
emergency_contact_phone TEXT
emergency_contact_relation TEXT
personal_email TEXT                            -- existing `email` column becomes company email
scheduled_confirmation_date DATE               -- offer/probation date
final_confirmation_date DATE
contract_end_date DATE                         -- relevant for employment_type='Contract'
notice_period_days INTEGER
date_of_retirement DATE
salary_mode TEXT
bank_name TEXT
bank_account_no TEXT
bank_ifsc TEXT          -- substituted for Frappe's `iban`: IFSC is the correct Indian bank-routing
                         -- field, IBAN is a European/international convention that doesn't apply
                         -- here — same "adapt, don't copy blindly" judgment already used for GST
ctc REAL                -- annual CTC, stored only, never a calculation input
salary_currency TEXT NOT NULL DEFAULT 'INR'
```
`name` stays a single field (not split into first/middle/last like Frappe) — a deliberate,
explained simplification: it already carries the full name correctly, and first/middle/last has no
named use case here (no biometric-device name-matching, no salutation-driven document templates).
Flagged here, not silently dropped.

### Additive columns — `employee_separation` (exit fields live here, not on `employees`)

Frappe puts exit fields flat on `Employee`; this schema already has a dedicated
`employee_separation` table (§12 decision 6, header+checklist), so the exit *fields* extend that
table instead of duplicating exit state on `employees` — more normalized, same information:
```
resignation_letter_date DATE
relieving_date DATE
reason_for_leaving TEXT
leave_encashed INTEGER NOT NULL DEFAULT 0
encashment_amount REAL                         -- Frappe only has encashment_date; an amount is
                                                -- the actually-useful number, added on top, not instead
exit_interview_held_on DATE
exit_interview_feedback TEXT
new_workplace TEXT
```

### Additive columns — `attendance_days`

```
in_time TEXT
out_time TEXT
working_hours REAL                             -- derived from in/out at write time when both present
late_entry INTEGER NOT NULL DEFAULT 0
early_exit INTEGER NOT NULL DEFAULT 0
leave_request_id INTEGER REFERENCES leave_requests(id)   -- closes the found gap: a 'leave'-status
                                                           -- day currently has no link back to the
                                                           -- request that caused it
```

### Additive columns — `leave_requests`

```
half_day INTEGER NOT NULL DEFAULT 0
half_day_date DATE
approver_id INTEGER REFERENCES employees(id)   -- designated approver (defaults from the employee's
                                                -- own reports_to); distinct from decided_by, which
                                                -- already records who actually clicked approve/reject
balance_at_application REAL                    -- snapshot taken at request time, so a later
                                                -- allocation change never rewrites history
```

### UI work (not just schema)

- **Employee detail Sheet** gains Address/Emergency Contact/Joining/Exit/Salary sections (edit
  form, mirroring the existing onboarding/separation sections' shape) and a **history view** —
  past leave requests, past attendance, past shift assignments — the "Connections tab" equivalent
  Frappe gets for free from its linked-document sidebar; ours needs building explicitly since
  there's no such generic mechanism here.
- **New Employee / Edit Employee forms** gain the new fields (grouped into the same
  Personal / Address & Contact / Joining / Salary sections named above).
- **Leave request form** gains half-day toggle; **approve/reject** defaults `approver_id` from
  `reports_to` if set, remains overridable.
- **Attendance mark** gains optional in/out time inputs (stays optional — most shop-floor marking
  will still be a plain status pick, punch times are for staff who actually use them).

### Explicitly still excluded (unchanged from §12's HARD BOUNDARY)

Salary *Structure*/*Slip* (the actual payroll run and its calculations), PF/ESI/PT/income-tax
deduction math, any GL posting from leave encashment or final settlement, Expense Claims,
Overtime pay calculation (the `overtime_type`/`working_hours` fields on Attendance are stored
facts, not a computed payroll input here). Performance/Training/Grievance remain deferred per
§12 decision 13, untouched by this section.

### Implementation record — STATUS: BUILT & VERIFIED (2026-08-10)

Built in the planned order: schema (`addColumn()` in `lib/db.js migrate()`) → `lib/hr.js`
(`deriveAttendanceMetrics`, `getShiftForDate`) → `lib/data.js` read helpers (`getAttendanceHistory`,
`getShiftHistory`, `getLeaveRequests(status, employeeId)`, `reports_to_name` self-join on
`getEmployees`/`getEmployeeDetail`) → API routes → `HrWorkspace.jsx`.

**API routes:** `app/api/employees/route.js` POST and `[id]/route.js` PATCH accept the full new
field set; new `app/api/employee-separation/[id]/route.js` PATCH for the exit-detail fields
(separate from the existing task-checklist route); `attendance/route.js` accepts `in_time`/
`out_time`, derives `working_hours`/`late_entry`/`early_exit` against the employee's shift for that
date (via `getShiftForDate`) when one exists, and gained an `employee_id`-only history mode on GET;
`leave-requests/route.js` POST accepts `half_day`/`half_day_date` (days = span − 0.5), defaults
`approver_id` from the employee's `reports_to` (overridable), and snapshots `balance_at_application`
via the existing `getLeaveBalance`; `leave-requests/[id]/route.js`'s approve step now stamps
`attendance_days.leave_request_id` on the days it creates; `shift-assignments/route.js` GET gained
an `employee_id` history mode (full history) alongside its existing current-only default.

**UI (`HrWorkspace.jsx`):** `EMPLOYEE_FIELD_GROUPS` (Personal / Address & Contact / Joining /
Salary) is one shared config rendered by `EmployeeFieldsForm` in both editable and read-only mode —
used by both the New Employee dialog and the Employee detail Sheet's new "Details" section (with
its own Edit/Save toggle, PATCHing only the §13 fields). The Separation block gained an "Exit
details" subsection (`EXIT_FIELDS` + `PlainFieldsForm`, same editable/read-only pattern) with a
`leave_encashed` checkbox. A new "History" section fetches and lists past leave requests, past
attendance (with in/out time and Late/Early badges), and past shift assignments for the employee.
Attendance marking gained optional in/out time inputs per row (`AttendanceRow`) that only appear
once a status is picked, surfacing the derived Late/Early badges. The leave request dialog gained a
half-day checkbox + date input.

**Verified (curl + direct DB assertions against the shared Turso DB):**
- `PATCH /api/employees/:id` round-trips every new field correctly, including `reports_to` (and its
  `reports_to_name` join resolves).
- Leave request POST with `half_day: true` computed `days: 0.5` correctly; `approver_id` defaulted
  to the employee's `reports_to`; `balance_at_application` snapshotted correctly (0, since no
  allocation existed yet).
- The existing 409-exceeds-balance rejection on approval still fires correctly with 0 balance;
  after allocating balance, approval succeeded and stamped `attendance_days.leave_request_id`
  correctly on the created day.
- Attendance POST with `in_time`/`out_time` against an assigned shift (09:00–17:00) derived
  `working_hours: 6.5`, `late_entry: 1`, `early_exit: 1` correctly for a 09:30–16:00 punch pair.
- `PATCH /api/employee-separation/:id` round-tripped every exit field (resignation/relieving/exit
  interview dates, `leave_encashed`, `encashment_amount`, `reason_for_leaving`, `new_workplace`)
  correctly.
- Browser pass: the Employee detail Sheet's new Details section (grouped, correct values), Edit
  mode (all field types render and are editable, including the `reports_to` employee-select), and
  History section (real data from the new endpoints, including a pre-existing real attendance mark)
  were confirmed rendering correctly in one clean session before the environment issue below hit.
- All test data created during verification (a test half-day leave request + its stamped attendance
  day, a test leave allocation, a test shift type + assignment, a test employee-separation record,
  and test field values written to employee EMP-1004) was cleaned up directly against the shared
  Turso DB afterward; EMP-1004 confirmed back to its pre-verification state.
- `npm run build` clean (twice), including `/hr` — no errors or warnings introduced.

**Environment issue found during verification, not a code defect:** this sandbox session had an
ambient auto-restarting `next dev` supervisor for this project that could not be reliably stopped
from the Bash tool (`kill -9` on its PIDs either silently failed or the process was immediately
respawned on a new port). Multiple `next dev` processes ended up running concurrently against the
same `.next` build directory for stretches of this session, corrupting the dev build (missing
chunks, failed hydration, transient 404s) independent of anything in this diff — confirmed by the
API layer responding correctly via curl throughout even when the browser UI was unable to hydrate.
Worth knowing if a future session hits the same "page renders but nothing is clickable" / "route
worked a minute ago, now 404s" symptom on this project: check `ps aux | grep next` for duplicates
before assuming a code regression.

**Non-blocking gaps found — documented, not fixed:**
- `late_entry`/`early_exit` derivation (`lib/hr.js` `deriveAttendanceMetrics`) is a plain
  in>start/out<end compare with no grace-period allowance — flagged in-code as a `ponytail:` with
  the grace-period column as the upgrade path if a real late policy is ever needed.
- No dedicated UI control to override `approver_id` at leave-request creation time — it always
  defaults from `reports_to` (settable via the API's `approver_id` field if ever needed); the spec's
  UI list only asked for the half-day toggle here.

---

## 15. HR completion bundle: Payroll (statutory) + Full & Final + Loans + Expense Claims/Advances — STATUS: BUILT & VERIFIED (2026-08-11)

**The §12 HARD BOUNDARY was intentionally reopened by explicit user decision** for exactly the
items it named as excluded (statutory PF/ESI/PT/TDS calculations; Expense Claim/Employee Advance/
Overtime, which "post to GL" in ERPNext) — **not because the reasoning behind that boundary was
wrong, but because the user now has a separate integration path**: a future "Tally agent" (and
other means) will read the numbers this bundle computes and sync them into real accounting
software. Shanti Ops therefore still builds **zero ledger/chart-of-accounts/journal-entry
infrastructure** — every figure here is computed once and stored as a plain fact, the exact
precedent `quotations.total`/`employees.ctc` already set. Every column a future accounting sync
will need is marked `-- ACCOUNTING INTEGRATION POINT` in `lib/db.js`: `salary_slips`'s REAL
columns (gross/deductions/net/PF/ESI/PT/TDS/overtime) and `expense_claims.total_amount` on
approved/paid rows. **This decision does not extend to any other HR/Selling doctype not explicitly
named here** — re-litigate case by case, same as the original boundary required.

Also closed in this bundle (the user's full list, minus HR — Performance/Training/Grievance which
stays deferred as originally instructed): the two §13 non-blocking gaps (attendance grace-period,
leave approver override), an undocumented Onboarding/Separation gap found during planning (no way
to add an ad-hoc checklist task), and the documented Recruitment gap (`job_offers` had a working
API but zero UI).

### Explicit scope boundaries (stated up front, not discovered as a surprise later)

- **New tax regime only** — HRA exemption/80C/other declarations (old regime) is a separate large
  rules engine, out of scope.
- **Section 87A rebate** is a simple full-rebate-below-threshold rule, not the precise marginal-
  relief taper right at the threshold.
- **Statutory rates/slabs are seeded with best-known figures at build time (today, 2026-08-11 →
  FY2026-27) but are editable configuration**, never hardcoded — verify them against the actual
  current law before relying on generated payslips for real payroll.
- No payslip email delivery or bank-file export — PDF generation only, mirroring the existing PO/
  Quotation PDF pattern.
- Non-recurring **Additional Salary** (arrears/bonus) only — a recurring allowance belongs in the
  salary structure instead.

### What was built

**Schema:** `salary_structures`/`salary_structure_components`/`salary_structure_assignments`
(no separate component master catalog — see `lib/db.js`'s comment on why, at this company's
scale); `statutory_rates` (single-row, editable), `professional_tax_slabs` (Telangana seeded),
`income_tax_slabs` (new regime, FY2026-27 seeded); `employees.pt_state`; `payroll_runs`/
`salary_slips`/`salary_slip_components`; `additional_salary`; `employee_loans`/`loan_repayments`
(reducing-balance EMI); `employee_separation.settlement_slip_id`; `expense_claim_types`/
`expense_claims`/`expense_claim_items`; `employee_advances`; `shift_types.grace_minutes`.

**`lib/payroll.js`** (mirrors `lib/hr.js`'s pure-function shape): Loss-of-Pay proration
(`payment_days`/`working_days`, unmarked days default to paid — the realistic default for salaried
staff not punched daily); PF (ceiling-capped, togglable), ESI (ceiling-gated), PT (state-slab
lookup); **YTD-accurate TDS** — projects the full year's taxable income from what's actually been
earned/deducted so far this FY (not a flat month×12 guess), so mid-year joiners and pay changes
compute correctly; overtime (hours beyond the scheduled shift × hourly-rate-from-Basic ×
statutory multiplier, reusing §13's `attendance_days.working_hours`/`getShiftForDate`); loan EMI
amortization; Full & Final settlement (prorated exit-month pay + leave encashment − outstanding
advances − loan foreclosure). One persistence entrypoint, `generateSalarySlip`, used by every
generation path (payroll run, ad-hoc slip, settlement) — same "one function, every caller"
precedent `createEmployeeWithOnboarding` already set.

**`lib/payslip-pdf.js`** mirrors `lib/po-pdf.js`/`lib/quotation-pdf.js` exactly.

**~20 new API routes**, **`components/PayrollWorkspace.jsx`** (Payroll Runs → Salary Slips →
Additional Salary → Structures → Statutory Settings) and **`components/ExpensesWorkspace.jsx`**
(Expense Claims → Advances → Loans), mounted as two new tabs in the existing `HrWorkspace.jsx`
(no new nav item/page). Small leftover UI: attendance grace-period awareness, leave-request
approver override, onboarding/separation "+ Add task", a "Generate Final Settlement" button on the
Separation section, and an Offer panel on the Recruitment Kanban's "offered" column.

### Two real bugs found and fixed during verification (not just the happy path)

1. **TDS's YTD "periods elapsed" was calendar-derived, not slip-derived.** It assumed payroll had
   been run every month since the employee's join date, so if this module is adopted mid-FY
   (earlier months paid a different way, no slip exists here for them), those "missing" months got
   silently averaged into the projection and diluted it, understating tax by exactly the missing-
   month fraction. Found live: a first-ever run for a mid-year test case projected ₹757,800 annual
   taxable income (below the rebate threshold, so ₹0 TDS) when the real projection was ₹2,423,400.
   Fixed by deriving "periods elapsed" from the count of actual prior slips in the FY (+1 for the
   current one) instead of months-since-joining; "periods total" (the correct denominator for
   whatever fraction of the year has slips) stays the calendar/join-date fact.
2. **Full & Final settlement's proration divided a truncated numerator by an equally-truncated
   denominator.** The exit-month period was correctly clamped to the relieving date for computing
   *payment days*, but that same clamped range was also used as the *working-days denominator* —
   so `payment_days / working_days` washed out to ≈1 whenever there was no mid-period absence,
   paying a **full month's Basic/HRA for a half-month worked** (confirmed live: a Aug 1–15
   settlement paid the complete ₹21,000 Basic+HRA instead of the correct ~₹10,080). Fixed by
   always dividing by the full calendar month's working days, while the numerator (`payment_days`)
   still only counts days through the relieving date.

Both were caught by hand-verifying the generated numbers against the seeded rates for two
representative employees (one at the PF-ceiling/ESI-eligibility edge with an absence + overtime +
active loan, one well above the TDS rebate threshold) across two consecutive payroll months, not
by trusting the code to be self-evidently correct.

### Verified (curl + direct-DB assertions against the shared Turso DB, after both fixes)

Every figure hand-checked exactly: LWP proration, overtime (hours beyond shift × rate ×
multiplier), PF at the wage ceiling, ESI at the eligibility boundary, PT slab lookup, loan EMI
reducing-balance amortization across two installments (principal↑/interest↓ correctly), YTD TDS
carrying consistently month-to-month for steady income (June and July landed on the identical
figure, as expected), a valid payslip PDF, an expense claim approved and correctly settling against
a referenced advance, and a Full & Final settlement correctly netting leave encashment + a second
advance's recovery + the active loan's foreclosure into one settlement slip (loan → `foreclosed`,
both advances → `settled`, `employee_separation.settlement_slip_id` linked). Onboarding/separation
ad-hoc task add and the job-offer create→accept flow also verified. All test data (test employees'
temporary field values, structure, assignments, slips, runs, loan, advances, claim, separation,
shift, attendance marks, job opening/applicant/offer) cleaned up from the shared DB afterward.
`npm run build` clean (twice) after cleanup.

**Environment note, not a code defect:** this session shared the working directory with (at least)
one other concurrent Claude Code session actively building the unrelated Calc module — visible in
`next.config.js`'s per-port `distDir` fix (their own fix for the same multi-`next-dev` corruption
problem §13's session hit) and in a mid-verification `ENOSPC` from `~/.npm` cache growing to 3.4G
across sessions (cleared with `npm cache clean --force`, a safe/recoverable operation, to unblock
the final build). Verification here ran its own dev server on a dedicated port (`next dev -p
4001`, auto-isolated by that same `distDir` fix) rather than fighting over a shared one.

---

## 14. Where things stand — read this first if picking up cold

- **Track A (§1–11):** built, verified, live.
- **§12 (CRM + Selling + HR core + Recruitment + Executive 360):** built, verified, live. Two real
  bugs found and fixed during verification (a timezone off-by-one in leave-approval attendance
  stamping, and a tab-layout CSS omission) — both documented in §12's Implementation record.
- **§13 (HR field-depth gap closure):** built, verified, live. Curl + direct-DB verification passed
  in full (see §13's Implementation record); browser verification was cut short by an ambient dev
  server instability in that session (documented in §13, not a code defect) after one clean
  confirming pass of the new Employee detail Sheet UI.
- **§15 (Payroll/FnF/Loans/Expense Claims/Advances):** built, verified, live. The HARD BOUNDARY
  named in §12 was intentionally reopened for exactly these items, by explicit user decision (a
  future accounting sync owns the ledger; this module only computes and stores). Two real bugs
  found and fixed during verification — see §15's record. Old tax regime, HR — Performance/
  Training/Grievance remain deferred.
- **Accounting (General Ledger / Chart of Accounts / journal entries) itself:** still permanently
  deferred — §15 computes statutory *numbers*, it does not build a ledger. GST/e-invoicing/e-way
  bill/returns-filing remain out of scope entirely, not reopened by §15.
- **Performance reviews / Training / Grievance / Warranty / AMC:** explicitly scoped and deferred,
  not oversights (§12 decision 13/14).

## 16. CRM record-keeping brought to full ERPNext CRM field/report parity (2026-08-12)

Checked against the actual ERPNext CRM docs (docs.frappe.io/erpnext/CRM), which also states the
module is **scheduled for removal in ERPNext v17** (Frappe recommends Frappe CRM instead) — worth
knowing before treating "ERPNext CRM" as a stable long-term target.

Added on top of §12's CRM: `leads.source/territory/industry` (source existed as a column since
§12 but was never in the create form — now is), `opportunities.source/lost_reason/
next_contact_date`, and a **Reports** tab on `/sales` (lead funnel by status, conversion rate,
leads by source, pipeline by stage with value, win rate, campaign performance) — computed
client-side from data already loaded, no new API/report page. Pipeline (`/pipeline`) also got an
inline open-value/win-rate strip.

**Deliberately not built — a real gap, not an oversight:** Email Campaign (scheduled send
sequences), Newsletter, Appointment as its own entity, Prospect. These need an actual email-
sending integration (SMTP/provider credentials) and are a materially bigger build than the
record-keeping above — asked the user, explicitly deferred. Revisit only when campaign email
sending is an actual near-term need, and get provider credentials first.

Also fixed while here: Marketing-department nav had no path to `/sales` (Leads/Campaigns) despite
having API access — `Nav.jsx`'s `/sales` tab and `app/sales/page.js`'s guard were Sales-only; both
now accept `Sales || Marketing`, same pattern already used for `/pipeline`. And a latent bug in
`leads`/`opportunities` POST: `owner_dept` defaulted to hardcoded `'Sales'` when the client didn't
send one (the form never did), so the access check right after it always rejected a Marketing-only
user — now defaults to a department the acting user actually has.

Once Marketing could reach `/sales`, it also got Customers/Quotations/Sale Orders — the commercial
fulfilment chain, which is Sales' job, not Marketing's. `SalesWorkspace.jsx` now takes a
`departments` prop (same "departments the viewer holds" shape `app/pipeline/page.js` already used)
and only renders those three tabs when the viewer holds Sales; Leads/Campaigns/Reports stay shared.
The Reports tab also got a **By department** table (leads, conversion, open pipeline, won value,
win rate split Sales vs Marketing) — the combined-only totals were hiding which department was
actually driving the pipeline, the same problem a shared total always has.

`/sales`'s tab bar was also converted to a collapsible left sidebar (shadcn Sidebar primitives,
`components/ui/sidebar.jsx`), same structural pattern `CalcWorkspace.jsx` already uses for
`/calc` — a flat `PANELS` array filtered by department instead of Calc's grouped sections, same
local-state active-panel mechanism. `/pipeline` stayed a single-page Kanban (no sub-navigation to
collapse into a sidebar).

## 17. CRM brought to Frappe CRM parity — Task, Call Log, Views, Assignment Rule, SLA (2026-08-12)

§16 checked against **ERPNext CRM**'s docs; this pass checked against the actual product ERPNext
points to instead — **Frappe CRM** (github.com/frappe/crm), a different codebase and data model
(Lead/Deal/Contact/Organization/Note/Task/Call Log, no Campaign doctype at all). Read its repo
doctype list and full docs nav (Core Records / Views / Other Features), not assumed from memory.

**What Frappe CRM actually has that ERPNext CRM didn't**, and what's now built to match:

- **Task** — reuses the existing cross-department `tasks` table (`lib/db.js`, already "every
  department's own ad-hoc task list on a month calendar") rather than a new table — a CRM task is
  just a task with `lead_id`/`opportunity_id`/`customer_id` set, same one-of-three discriminator
  `crm_notes` already uses. New thin API (`app/api/crm-tasks/`) instead of extending
  `app/api/production/tasks/route.js`, which carries Production-only baggage (`from_department`,
  `bom_item_id`, cross-department notify) that doesn't apply to a CRM task. Surfaces in three
  places: a new Lead detail sheet (didn't exist before — Leads only had a Convert button), the
  existing Opportunity detail sheet, and a shared **Tasks** sidebar panel listing every CRM task
  across all three link types. Unassigned by default (unlike Production's own board, which falls
  back to the creator) — a CRM task quietly owned by whoever happened to create it would hide that
  nobody's actually following up.
- **Call Log** — not a new doctype; `crm_notes` (already had `note_type='call'`) gained
  `call_type` (incoming/outgoing) and `duration_seconds`, populated only when the "Log as a call"
  toggle is checked in the notes composer.
- **Views** ("Saved View"/"Pinned View" in Frappe CRM's own docs) — `crm_saved_views` table,
  personal to the user who saved it (not shared/team-wide, matching Frappe CRM's own scope).
  Scoped to Leads only for now (status/source/search filters); a pinned view is a clickable chip
  that reapplies the saved filter set.
- **Assignment Rule** — scoped down to the one pattern that mattered: round-robin a department's
  new leads across a configured username list (`crm_assignment_rules`, one row per department,
  `next_index` advances on every auto-assign). Configured via a new **Team** sidebar panel,
  dept-scoped edit (a Marketing head can only set Marketing's list, same boundary as everywhere
  else in CRM). No rule configured -> lead stays unassigned, same "visibly unowned rather than
  silently defaulted" choice Task made above.
- **SLA** — `SLA_HOURS = 24` constant (`components/SalesWorkspace.jsx`), not Frappe CRM's full
  SLA doctype (business-hours calendar, holiday list, per-priority windows). A lead still in
  `new` status past that threshold gets a red "SLA overdue" badge on the Leads table and rolls up
  into a count on the Reports tab. `ponytail:` flagged in the code — add real business-hours
  config if a different threshold or per-department SLA becomes a real need.

**Explicitly not built — a real gap, not an oversight, confirmed against Frappe CRM's docs
directly:** email/WhatsApp/Twilio/Exotel integration (already deferred per §16, user confirmed
again), Organization as a separate doctype from Customer (would be redundant — Customer already
covers it), Territory (already deferred, §12), a schema-level custom-fields builder or Form
Script (structurally out of scope for a bespoke app, not a CRM feature gap).

**Verified live** (Marketing Head and Sales Head, via the shared Turso DB, test rows cleaned up
after): lead + task + call-log creation end to end, round-robin auto-assignment on a second lead
after configuring a rule, saved-view persistence across reload, dept-scoped Team panel (each head
sees only their own department's row), SLA count on Reports, Tasks panel inside the Opportunity
detail sheet. `npm run build` clean throughout.

## 18. Scope of Supply draft, Sales→Stores flow verified, Reports as its own tab (2026-08-12)

**STATUS: CRM work is not "done" — this section and §16/§17 are the running record. Keep adding
here until the user says the CRM work is finished.**

### Trading (Sales enquiry → Stores → Procurement) — verified, already built
Checked against the user's description: Sales readies an enquiry, sends it to Stores, Stores
reserves stock or asks Procurement for the shortfall. This already exists under the name **SAS
("Sold-As-Such")**: `bom_items.source = 'sas'`, documented in `SYSTEM.md` §5e. Lead→Quotation→
Sale Order works (`app/api/quotations/[id]/convert/route.js`); Stores has a real reserve/issue/
release mechanism (`lib/procurement.js` — `reserveFromStock`/`issueReservation`/
`releaseReservation`, tested via `scripts/inventory-reservations-selfcheck.mjs`); Stores can raise
a PR to Procurement (`PR_DEPARTMENTS` includes Stores, `app/api/purchase-requisitions/route.js`,
server-enforced Stores-only for `stock`/`sas` sources). **One real gap, not fixed this round**: no
automatic Sales→Stores handoff — `sale_orders` creation/status-change raises no task or
notification, and `bom_items.sale_order_no` is free-text, not an FK, so Stores must manually
search for the SO number. Flag for a future pass if it becomes a real friction point.

### Scope of Supply / Work Order (Sales confirmed order → Design + Engineering) — draft built
No real format exists yet ("I don't have a format... as this is a boiler company, I am guessing it
would be filled with configuration" — user's own words) — built as an **educated draft**, meant to
be replaced once the real format is provided, not a finished feature:
- New `scope_of_supply` table (`lib/db.js`): `project_id`, `title`, a free-text `spec` field (not a
  structured boiler-configuration schema), `status` (draft/released).
- Auto-created when a Project is linked to a Sale Order (`app/api/projects/route.js` — a draft row
  seeds the moment `sale_order_id` is set, since that's this system's actual "order confirmed"
  moment; there's no separate `confirmed` status on `sale_orders` today).
- Replaces `components/DesignPanel.jsx`'s year-old inert placeholder card ("awaiting Work Order /
  Scope of Supply format" — `CALC-CHANGES2.md` §D), and also now renders in Engineering's own tab
  (`components/DepartmentPanel.jsx`) — **the same row, not department-split**, since it's one work
  order both departments read from. New shared component: `components/ScopeOfSupplyPanel.jsx`.
- Verified live: draft auto-creates, spec edits save, Release flips status, and Engineering sees
  the exact same released row Design entered — confirmed the two departments are genuinely joined
  on this document, not two copies.

### CRM Reports — pulled out of Sales into its own top-level tab, with charts + PDF
User: "the reports should be a main tab instead of within Sales tab... sidebar for all reports...
separated by sales or marketing... mature visualization... downloadable."
- New nav tab `Reports` (`components/Nav.jsx`, same `inSales || inMarketing` shared-tab pattern as
  Pipeline) → `app/crm-reports/page.js` → `components/CrmReportsWorkspace.jsx`, same
  sidebar-workspace shell as `SalesWorkspace`/`CalcWorkspace`, grouped into **Sales** (Sales
  Pipeline, By Department) and **Marketing** (Lead Funnel, Leads by Source, Campaign Performance)
  sidebar sections — a Marketing-only head sees only the Marketing group, Sales-only sees only
  Sales, matching the same department gating as everywhere else in CRM. `ReportsTab` and its
  helpers were deleted from `SalesWorkspace.jsx` (moved wholesale, not duplicated).
- **Charts**: reused the app's own existing bar idiom (`components/BomProgress.jsx` — thin rounded
  bars on `bg-muted`) instead of adding a charting dependency. Magnitude gets one hue (`bg-chart-1`,
  the app's own existing categorical/chart token ramp in `app/globals.css`); Won/Lost/Converted
  rows get the reserved status tokens (`bg-success`/`bg-destructive`) — dataviz skill's "sequential
  = one hue, status colors reserved" rule, never mixed on one chart.
- **"Download PDF"**: the browser's native print-to-PDF (`window.print()`) against a scoped print
  stylesheet (`app/globals.css` `@media print`, `#report-print-area`) — no PDF library added. Note
  for the record: Frappe CRM itself has no PDF-export feature for its views (checked its full docs
  nav) — this is genuinely new scope beyond either CRM being used as a reference, not a gap being
  closed.
- Verified live: nav tab appears, sidebar correctly splits by department (re-verified after an
  earlier false alarm — see below), bar charts render with real proportions once a lead/source
  existed, print stylesheet rule confirmed present in the compiled CSS.
- **Correction during this work**: first login attempt clicked the wrong demo-login button (Sales
  Head instead of Marketing Head) and momentarily looked like a department-gating bug. It wasn't —
  re-verified with the correct login and the split is correct. Noted here so it isn't mistaken for
  a real incident if this file is read cold later.

### WhatsApp / Email quick-links — added
`components/SalesWorkspace.jsx`'s new `ContactLinks` component: a `wa.me/<number>` link and a
`mailto:` link next to any phone/email already on file (Lead detail sheet, Customer detail sheet,
per-contact rows). Opens WhatsApp Web / the user's mail client — **not** a WhatsApp Business API or
email-sending integration (that's the already-deferred item from §16/§17).

### Noted for later — NOT started
User: "we need to think on how many documents we need like sales invoice and others... figure out
how many of those requires input from accounts." This is a future scoping pass (which Selling/
Accounting documents — Sales Invoice, Credit Note, etc. — this system needs, and which ones need
Accounts' involvement vs. can stay Sales-only) — **explicitly not scoped or built this round**,
recorded here so it isn't lost.

## 19. CRM roadmap — recorded, explicitly NOT built yet (2026-08-12)

User asked for these to be noted only ("do not start working on these. just note it.") — a punch
list for a future round, not a design commitment yet.

### Dashboard report (top of Reports, both departments)
A stat-tile + trend-chart dashboard matching the reference screenshot the user shared (ERPNext's
own CRM dashboard): Total leads, Avg. time to close a lead, Ongoing deals, Won deals, Avg. won deal
value, Avg. deal value, Avg. time to close a deal, a "Sales trend" line chart (leads/deals/won
deals per day), a "Forecasted revenue" chart (projected vs actual by deal probability). Needs to be
department-split (Sales vs Marketing see different stat sets) and needs a **top-right "viewing as"
dropdown** — pick yourself or a teammate and see their numbers.

**Real gap this exposes, not previously flagged**: today `opportunities`/`leads` are owned at the
*department* level (`owner_dept`) — `leads.assigned_to` exists (§17) but **opportunities have no
individual-rep ownership field at all**. A per-person dashboard needs per-person data to filter by,
so this isn't just a UI build — it needs an `assigned_to` (or equivalent) on `opportunities` first,
plus a per-stage timestamp history to compute "avg. time to close" honestly (today there's only
`created_at`/`updated_at`, no stage-change log, so "time to close" would currently have to be
approximated from `updated_at`, which isn't the same thing).

### Marketing reports requested — overlap check against what's already built (§18)
| Requested | Status |
|---|---|
| Campaign Performance Report | **Already built** (§18) — leads + opportunity value per campaign |
| Lead Source Effectiveness Report | Partial — "Leads by Source" (§18) counts leads per source; "effectiveness" implies *conversion rate* per source, which isn't computed yet |
| Customer Acquisition Cost (CAC) vs. ROI Report | Not built — feasible with existing `campaigns.budget` vs. opportunity value won, but needs a defined CAC formula agreed first |
| Conversion Rate / Attribution Report | Partial — overall lead conversion rate exists (Lead Funnel report); *multi-touch attribution* (crediting more than one campaign/source per conversion) does not exist and the data model doesn't support it today (one `campaign_id` per lead, not a touchpoint history) |
| Customer Retention & Churn Report | Not built — no concept of "churn" exists at all today; would need repeat-purchase/order-recency tracking on `customers`/`sale_orders` |

### Sales reports requested — overlap check
| Requested | Status |
|---|---|
| Sales Pipeline Velocity Report | Not built — needs a stage-change timestamp log (doesn't exist; `opportunities` only has `updated_at`, not a history of which stage changed when) |
| Sales Forecasting Report | Not built — needs a weighted-pipeline forecasting model (probability × value by expected close date); `probability`/`expected_close` fields exist on opportunities so the raw inputs are there, the model/report isn't |
| Win/Loss Analysis Report | Partial — win rate exists (Sales Pipeline report), `lost_reason` field exists (§16) but nothing aggregates *why* deals are lost across the pipeline yet |
| Sales Activity Report | Partial — Tasks/Notes/Call Log exist (§17) but nothing rolls them up into a per-rep activity-volume report |
| Deal Aging & Stalled Deals Report | Not built — needs "time since last activity" per opportunity, which needs the notes/tasks timeline to be queried against, not just opportunity fields |

Every report gets a "Download PDF" button — same native `window.print()` mechanism already built
for the existing reports (§18), no new work needed there once each report exists.

### Operations tab — flow-diagram revamp
User wants the same kind of visual flow-diagram treatment Operations already has, built fresh for
Sales and Marketing (each gets its own diagram — the funnels are related but not identical, per
§17's "one shared funnel, Sales does fulfilment, Marketing doesn't" model). Not scoped or started.

### Maturity assessment, asked directly
User asked whether this is "world class" CRM maturity. Answer given: no — this is a solid
record-keeping + reporting foundation (matches ERPNext CRM depth, partially matches Frappe CRM's
day-to-day tools) but has none of: automation/workflow triggers, a unified two-way inbox, real
analytics (forecasting/cohort/attribution modeling — bar charts and tables aren't that), a
dashboard, a custom-fields/workflow-builder layer, a real business-hours SLA engine, or mobile/AI.
Closing that gap is a materially bigger, multi-round effort, not a polish pass — recorded here so
future sessions don't assume "CRM parity" work is close to finished.

## 20. CRM Help — `/help` gets its first Sales/Marketing content (2026-08-12)

`/help` (`app/help/page.js` + `components/help-content.jsx`) existed before this but had **zero
content for Sales or Marketing** — `HEAD_GUIDES` never had those two keys, so a Sales-only or
Marketing-only head landed on the "No departments assigned yet" empty state despite having a full
department to work in. Confirmed via exploration before building, not assumed.

Built, inspired by the ERPNext CRM docs structure the user pasted (Introduction → what it covers →
workflow):
- `components/help-crm-content.jsx` — plain data, same "no CMS" convention as the existing
  `help-content.jsx`: `CRM_INTRO` (a short multi-paragraph summary, titled "Introduction to Sales"
  per the user's exact wording), `CRM_FEATURES` (12 entries — Leads, Opportunities/Pipeline,
  Campaigns, Customers, Quotations, Sale Orders, Tasks, Notes & Call Log, Saved Views, Team/
  Assignment Rules, Reports, WhatsApp/Email links — each a few short plain-English paragraphs,
  each tagged with `depts` where it's Sales-only or Marketing-only so the sidebar only shows what
  the viewer actually has), `CRM_HOWTO` (8 numbered steps, Lead → work it → Convert → work the
  deal → Quote → confirm the Sale Order → hand off to Design/Engineering's Scope of Supply →
  keep the pipeline honest).
- `components/CrmHelpWorkspace.jsx` — new sidebar workspace, same shadcn Sidebar pattern as
  `SalesWorkspace`/`CrmReportsWorkspace`/`CalcWorkspace`: **Introduction to Sales** (single page),
  **Features** (grouped list, filtered by department), **How To** (single page, numbered).
- `app/help/page.js` — wired in without touching the existing department-grid page for every other
  department (Design/Engineering/Procurement/etc. keep exactly what they had). A PM previews both
  Sales and Marketing content; a Sales-only or Marketing-only head sees only their own department's
  Features; a head who holds Sales/Marketing *and* another department sees the CRM sidebar plus
  their other department's existing grid card below it, unchanged.

**Not yet live-verified in the browser this round** — user is conserving tokens; `npm run build`
is clean (`/help` compiles at 6.73 kB) but a visual pass (does the sidebar render correctly for
Marketing Head vs Sales Head vs a dual-department head) is still outstanding. Verify before
treating this as fully done.
