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

## 14. Where things stand — read this first if picking up cold

- **Track A (§1–11):** built, verified, live.
- **§12 (CRM + Selling + HR core + Recruitment + Executive 360):** built, verified, live. Two real
  bugs found and fixed during verification (a timezone off-by-one in leave-approval attendance
  stamping, and a tab-layout CSS omission) — both documented in §12's Implementation record.
- **§13 (HR field-depth gap closure):** built, verified, live. Curl + direct-DB verification passed
  in full (see §13's Implementation record); browser verification was cut short by an ambient dev
  server instability in that session (documented in §13, not a code defect) after one clean
  confirming pass of the new Employee detail Sheet UI.
- **Accounting/GST/TDS/statutory payroll:** permanently deferred by product decision (§12), not
  something to reconsider without a fresh, explicit decision.
- **Performance reviews / Training / Grievance / Warranty / AMC:** explicitly scoped and deferred,
  not oversights (§12 decision 13/14).
