# Production Department — Module Design

**Status: COMPLETE (v1), kept as the record** — full history, rationale, and the ERPNext
comparison live here; `SYSTEM.md` §5g/§3a carry the as-built summary, the same split this codebase
already uses for `PROCUREMENT-CHANGES.md` vs `SYSTEM.md` §5c. Read this doc for *why*; read
`SYSTEM.md` for *what's true right now*.
**Date:** 2026-08-16
**Purpose:** Define the shop-floor execution layer for the Production department, and state
explicitly which ERPNext Manufacturing concepts we adopt, which we already cover elsewhere, and
which we deliberately skip. Written to be handed to another reviewer (incl. an AI) for a
side-by-side comparison against ERPNext's Manufacturing module.

> Companion to `SYSTEM.md` (the as-built system of record), `QC-FOLDER-DESIGN.md`, and
> `DESIGN-OPS-REDESIGN.md`. Nothing here deletes existing modules — it adds a layer and unifies a
> roster that has drifted (§2.5).

---

## 0. Status — what's built vs. still pending

**Built and live:**

| Piece | Where |
|---|---|
| One people master — Production Workers UI reads/writes `employees`, not a second table | §2.5 |
| Search-first Add-worker (HR first, create only if no match) | `app/api/production/workers` |
| `trades`, `operations`, `workstations` masters, seeded | §3.2 |
| `job_cards`, scoped to a **real Production milestone** (`lib/milestones.js`), not an invented step name | §3.1 |
| `job_card_time_logs` (multi-segment) + `job_card_consumables` | §3.1 |
| Job Card Kanban board, nav renamed `Workers` → `Job Card`, default landing tab | §3.1 nav decision |
| Daily Sheet: Overview + Sheet merged into one nested sub-sidebar (not two competing top-level tabs) | — |
| Daily Sheet attendance writes to HR's `attendance_days` — confirmed one shared attendance system, not two | §2.5 |
| BOM tab in the Job Card workspace — cross-project picker + the existing `BomTable`/`getProjectBom`, Production's real field ownership (`issued_ref`/`received_ref`) | §3.3 (read side) |
| `material_issues` API, Stores **or Production** can issue (mirrors Production's existing `issued_ref`/`received_ref` authority on the BOM itself) | §3.3 |
| `employees.cost_rate_per_hour` — settable from HR's employee edit screen | §3.6 |
| **Labor cost** — Job Card detail shows per-log cost + a card total (`Σ minutes/60 × rate`, at today's rate — not a frozen historical figure) | §3.6 |
| **Fabrication-% rollup** — shown as progress bars per milestone in the BOM tab, once a project is picked | §3.4 |
| **Material issue UI** — issue-material mini-form + recent-issues list, live in the BOM tab | §3.3 |
| **Rework loop UI** — "Create rework card" button on the Job Card detail sheet, spawns a linked pending card against the same milestone | §3.5 |
| **Site vs. shop-floor flag** — `job_cards.is_site`, checkbox on creation, badge on the tile/detail | new this round |
| **Hydro Test moved QC → Production** (`lib/milestones.js` + a migration for already-seeded projects) | new this round |
| Bug fix: `getJobCards`/`getJobCardDetail` had an `INNER JOIN operations` left over from when `operation_id` was required — since it's now optional, any card without one would have silently vanished from the board. Fixed to `LEFT JOIN`. | found this round |

**Hydro Test ownership — now fully transferred, not shared.** `qc_records` is split by `test_type`:
a hydro-test record (`POST`/`PATCH`/`DELETE /api/qc-records`) is Production's alone now
(`canAccessDepartment(user, 'Production')`); every other test type (radiography/NDE, MTC, freeform)
stays QC-exclusive, same table, no new column needed. The actual record UI (pass/fail, cert number,
inspector) now also renders on the project page's **Production** tab — `QcPanel` gained `title`/
`defaultTestType` props so its heading and add-form read "Hydro Test" there instead of "QC Records",
and its test-type field locks to that value rather than free text. QC's own tab is unaffected.

**Multi-company — resolved, and moved to the right place.** Originally scoped as a `projects.company`
field; corrected mid-build (client point: the entity is decided at the *Sale Order*, the actual
commercial commitment, not typed onto a project after the fact). `sale_orders.company` is now the
source of truth (both creation paths — direct `POST /api/sale-orders` and the quotation→convert
flow — plus `PATCH` for edits); `projects.company` is a denormalized copy, set from the sale order
at project-creation time, falling back to a manual picker only for a project created without one
(same shape as `customer_id`/`sale_order_id` already being copied). `New Sale Order` and `New
Project` dialogs both got a Company select; the project header now shows it. QC statutory documents
now default to the *project's* company on creation instead of always Shanti Boilers — the
`COMPANIES` list that existed as three separate copies (two in `qc-documents` routes, implicitly a
third in `qc-doc-pdf.js`'s `COMPANY_PROFILES` keys) is now one export, `COMPANY_NAMES`, everyone
imports.

**Robustness pass (2026-08-16, closing round) — every tracked gap resolved except one intentional
deferral:**

- **PO/payslip PDFs** — no longer hardcoded. `getPurchaseOrderDetail` derives the PO's company from
  its `po_items` → `bom_items` → `projects.company` chain (falls back to Shanti Boilers only when a
  split PO genuinely spans two companies, never guesses). `employees.company` is a new column
  (payslip's own axis — an employee's employer, not a project's); `getSalarySlipDetail` reads it.
  Both `lib/po-pdf.js` and `lib/payslip-pdf.js` render the correct letterhead/GST/sign-off via the
  same `companyProfile()` export `lib/qc-doc-pdf.js` already had — no more copy-pasted header
  strings. No dedicated HR form field to *set* an individual employee's company yet (API-editable
  via `PATCH /api/employees/[id]` only) — small, low-frequency, same shape as the sale-order gap
  below was before this round.
- **QC-side rework trigger** — built. A failed Hydro Test record shows "Create rework card" inline
  (`QcPanel`'s new `reworkMilestoneId` prop, only ever passed on the Production/hydro instance),
  posting straight to `/api/job-cards` with `qc_record_id` set for lineage.
- **No admin UI for Operations/Workstations/Trades** *(found and fixed alongside these, not
  originally tracked)* — `components/QuickAddInline.jsx`, a small `+` popover, wired into the New
  Job Card dialog and Add Worker dialog. No more needing direct API access to add an 8th
  workstation.
- **No Sale Order company edit after creation** *(found and fixed alongside these)* — the company
  cell in the Sales Orders table is now an inline Select, same pattern as the roster's trade field.
- **Time logs captured minutes only** *(found and fixed alongside these)* — the Log-hours form now
  offers Start/End time inputs; the API computes minutes from real clock times when given, minutes
  entry remains the fallback. `from_time`/`to_time` are no longer dead columns.
- **QC's own tab still showed hydro rows as editable** *(a real bug found during this pass, not a
  gap)* — `DepartmentPanel.jsx`'s QC block passed unfiltered `qcRecords` after the ownership
  transfer, so edit/delete controls rendered for rows that would now 403 on click. Filtered.
- **Existing STF- projects defaulted to the wrong company** *(a real bug found during this pass)* —
  the `projects.company` migration defaulted every row to Shanti Boilers, contradicting this
  system's own documented rule (`STF-` → Shanti Techno Fab, §5d). Backfilled by that rule instead.
- **Cost label clarity** — the card total now reads "₹X labor only" with a tooltip, so it can't be
  mistaken for total job cost (consumables still have no price attached — a real, named limit, not
  a bug).

**Left as-is, on purpose:** **Worker pre-assignment** — no way to say "Ramesh is on Shell Welding
today" before he logs hours. Matches ERPNext's own model (assignment happens by handing out the
card, not a system field) — not a regression, not built.

---

## 1. Domain framing (read this first)

Shanti is **engineer-to-order (ETO) heavy fabrication**, not repetitive/discrete manufacturing.
Each order is one custom equipment train — boiler, ID fan, chimney, etc. — captured as a hand-made
**Project Master BOM** (one workbook per project, one sheet per subsystem, IBR/statutory context).
See `SYSTEM.md` §5a.

This framing is the whole design. It means large parts of ERPNext's Manufacturing module solve a
problem we do not have:

- We do not forecast demand and plan production runs — the **BOM already enumerates exactly what to
  fabricate**, per project.
- We do not make N identical units — we make **one** custom assembly per subsystem.
- We do not need MRP, batch/repetitive routing, or a finite-capacity scheduler.

What we are actually missing is the **execution object between the `Production` milestone and the
shop-floor attendance sheet** — a record of *"this specific piece of work, on this station, by
these workers, in this state, costing this much labor."* That object is the **Job Card**, and it
dictates everything else in this doc.

### How a fabrication shop actually runs (industry primer)

For heavy/IBR fabrication (boilers, ID fans, chimneys):

1. **Order → drawings + BOM.** Engineering releases the Master BOM per subsystem.
2. **Stores issues raw material** — plates, pipes, flanges — to the shop floor. In IBR work each
   material is traceable to its **heat number / test certificate**.
3. **The piece travels through operations, in sequence:** marking → cutting → rolling/forming →
   fit-up → welding → grinding → machining → **NDT/testing** (radiography, hydro test) → painting →
   dispatch. This sequence is the **route card / traveler** — which is exactly what a job card is.
4. **A foreman/supervisor assigns each operation to a worker by trade** and records hours. Fitters
   do fit-up, welders weld, machinists machine.
5. **QC inspects at hold points** — weld visual, radiography, hydro test — per IBR.
6. **Fail → rework loop** back to the shop.
7. **IBR nuance:** every weld is traceable to a **qualified welder** (welder qualification /
   WPS-PQR). Welder-to-weld traceability is a statutory requirement — this is the deep end (§9).

**Trade vs designation — the axis that matters here:**
- **Trade / skill** = *what a person can physically do* (welder, fitter, gas-cutter, machinist,
  grinder, painter, helper). **Work is assigned by trade.**
- **Designation** = *HR job title / pay grade* (Senior Welder, Charge-hand, Foreman). Drives
  payroll and org hierarchy, **not** who does a given weld.

Job cards assign by **trade**, never by HR designation.

---

## 2. What already exists (do not rebuild)

The system already covers several ERPNext Manufacturing / adjacent concepts. This module reuses
them rather than duplicating.

| ERPNext concept | Already in Shanti (`SYSTEM.md` ref) |
|---|---|
| BOM (bill of materials) | **Master BOM / PMB** — `bom_items`, department-field-scoped (§5a) |
| Quality Inspection | **QC records** — `qc_records`, QC-owned test log (§5b) |
| Employee master + HR | **`employees`** + payroll/leave/attendance/designations (§ HR) |
| Attendance (shop floor) | **`worker_days`** today; HR's `attendance_days` is the newer master |
| Kanban work state | **Workflow Stages** — `milestone_stages`, Open/Current/Closed (§3c) |
| Purchasing / Purchase Order | **Procurement** — `suppliers`, `purchase_orders`, `po_items` (§5c) |
| Material issue/receipt (as text) | `bom_items.issued_ref` / `received_ref` free-text fields (§5a) |
| Costing (material side) | BOM + PO give material cost per line |

---

## 2.5 People model — one employee master, one Production view (IMPORTANT)

**Current state — a roster that drifted.** The system has *two* tables for the same shop-floor
people:

- `workers` (`lib/db.js:343`) — legacy Production roster (name, `trade`, active). **Still written**
  by `app/api/production/workers/route.js` and `components/WorkersPanel.jsx`.
- `employees` (`lib/db.js:1270`) — the HR single-master. Comment: it "absorbs the old
  Production-only workers table." Has `designation_id`, `employee_type` (`'staff'|'worker'`),
  payroll/leave/attendance, and an optional `user_id` link to a login account.

Workers were copied into `employees` **once** (`seedV3HrData`, `lib/db.js:2297`, guarded by an
empty-table check). Workers added via Production *after* that snapshot never reach HR. The two
rosters have diverged; the code comments claim `workers` is "retired" but its write path is live.

**Decision (approved).** `employees` is the **single source of truth** for every person. There is
**no second roster table**. Production keeps a *specialized view*, not its own master:

| Owner | Owns |
|---|---|
| **HR** | employee identity, employee code, department, **designation**, reporting manager, payroll, attendance, leave, joining/exit |
| **Production** | **trade/skill**, production availability, shift/work assignment, **job-card assignments + production work history** |

Rules:
- A shop-floor worker is an `employees` row with `department='Production'`,
  `employee_type='worker'`.
- **Designation is never duplicated into Production** — it comes from HR (`employees.designation_id`).
- **Trade/skill** is a controlled field (§3.2 trades master), owned/edited by Production.
- The Production Workers UI **reads/writes the `employees` record**, not a separate `workers` master.
- Migration: fold the live `workers` write path into `employees`; retire `workers` as a write
  target (keep the table for `worker_days` history until attendance also moves to `attendance_days`).

Net: **one employee record, a specialized Production worker view.**

### 2.6 Adjacent gap found, not fixed here: company/entity

Shanti operates as **two legal entities** — Shanti Boilers & Pressure Vessels Pvt Ltd and Shanti
Techno Fab Pvt Ltd (client-confirmed, `lib/qc-doc-pdf.js`) — but this is currently modeled *only*
at the QC statutory-document level (`qc_documents.company`, a two-value picker the doc's own
comments flag as "incomplete"). `projects` itself has no `company` column, and the PO/payslip PDFs
are hardcoded to Shanti Boilers only. This predates job cards and is bigger than this module (touches
PO/payslip PDF templates too) — flagged here, not solved here. Once fixed, job cards need **no
column of their own** for it: they'd inherit whichever entity their `project_id` belongs to.

---

## 3. Modules to build (ranked)

### 3.1 Job Cards — the core

A **Job Card** is one discrete unit of shop-floor work: an operation, at a workstation, by one or
more workers (by trade), against a subsystem/BOM scope, with quantities, state, time, and labor
cost.

Proposed `job_cards` table:

| Column | Purpose |
|---|---|
| `id` | PK |
| `project_id` → `projects` | which order |
| `section` | subsystem (BOM sheet name, e.g. BOILER / ID FAN) — **primary work scope** |
| `bom_item_id` → `bom_items` | optional, when a card maps to a single BOM line (nullable) |
| `operation_id` → `operations` | what step (cutting, rolling, fit-up, welding, machining, paint, test) |
| `workstation_id` → `workstations` | where / which machine |
| `qty_planned` / `qty_done` / `qty_rejected` | progress + rejection |
| `status` | Pending / In-progress / On-hold / Done (drives a Kanban like `milestone_stages`) |
| `is_paused` (bool) | overlay on an In-progress card — work started, currently stopped, not done. Cheap, ERPNext has it, worth it. |
| `planned_start` / `planned_end` | schedule |
| `actual_start` / `actual_end` | for cycle-time — the roll-up of `job_card_time_logs` below |
| `is_outside` (bool) + `outside_vendor` (text) | subcontracting-as-a-flag (§5) |
| `notes` | free text |
| `created_by` / timestamps / audit | standard, via existing `audit()` |

**Time logs, not a single hours field.** A worker's day on one card is rarely one unbroken stretch —
breaks, interruptions, coming back to finish a weld tomorrow. `job_card_time_logs` — `id`,
`job_card_id`, `employee_id` → `employees` (a `department='Production'`, `employee_type='worker'`
row), `from_time`, `to_time`, `minutes` (derived, stored for query convenience), `qty_completed`
(optional, if that segment finished a discrete unit of the planned qty). One row per work session;
a card's total hours and total labor cost are both sums over its rows. **Assignment is filtered by
the employee's trade** (§3.2) — the foreman sees available welders for a welding operation, etc.

**Consumables**, separate from the BOM. Welding rods, grinding discs, gas — used doing the work but
never a BOM line item. `job_card_consumables` — `id`, `job_card_id`, `item_name` (free text), `qty`,
`unit` (free text). Lightweight by design: no Item/Code/Type master, no stock ledger — just a record
of what got used, matching the free-text-refs precedent `bom_items` already uses for BQ-TC/GRN.

**Ownership:** whole-row, Production-scoped + PM — same pattern as `qc_records` (§5b), *not* the
field-level split the BOM uses (§5a).

**Reuse:** `employees`, `bom_items`, `projects` all already exist. Status Kanban reuses the
`milestone_stages` visual pattern (§3c).

**Resolved, not by BOM line or free-text section, but by milestone.** The original open question
here — does a job card map to one BOM line, one subsystem, or a batch of lines — turned out to have
a cleaner answer once we checked what already existed: `lib/milestones.js` already carries the real,
client-sourced production step vocabulary (`Shell Welding`, `Box Up Welding (OS / IS / G)`, `Tubes &
Stay Rods — Insert & Welding`, ...), seeded per project. **`job_cards.milestone_id` is the primary
scope** — `project_id` and `section` (= the milestone's label) are derived server-side from it, not
taken from the client, so they can't drift out of sync the way a free-typed section name could.
`bom_item_id` stays optional, for the cases that do map to one specific line. This is what makes the
fabrication-% rollup (§3.4) correct by construction instead of by name-matching. `operation_id`
demoted to optional — most milestones are already one specific action; it's a finer tag only for the
few that bundle several verbs (`Marking, Cutting, Rolling Shell`).

**Where it lives in the nav (built).** The Production `Workers` tab is now **`Job Card`** — the
board is the default landing view, `Daily Sheet` (Overview + Sheet merged into one nested
sub-sidebar) and `Workers Roster` are sub-tabs beneath it, and a `BOM` tab sits alongside them
(cross-project picker + the existing `BomTable`, §3.3). The now-redundant `Tasks` nav item
(`/production` — was identical to `Home`) is dropped from `Nav.jsx`.

### 3.2 Operations, Workstations, and Trades — the masters

Job cards are meaningless without a **"what step + where + by which skill"** dimension. Three small
master tables (same precedent as `stage_templates`, `shift_types`, `designations`).

`operations` — `id`, `name`, `default_minutes` (optional standard time), `active`.
e.g. Marking, Cutting, Rolling, Fit-up, Welding, Grinding, Machining, Painting, Testing/NDE.

`workstations` — `id`, `name`, `machine_hour_rate` (optional, for costing), `active`.
e.g. Plasma Cutter, Rolling Machine, Weld Bay 1, CNC Lathe, Paint Booth.

`trades` — `id`, `name`, `active`. e.g. Welder, Fitter, Gas Cutter, Machinist, Grinder, Painter,
Rigger, Helper. **Production-owned.** The shop-floor `employees` row's trade points here (replacing
today's free-text `workers.trade`), so job cards can filter workers by skill ("show available
welders"). This is distinct from HR's `designations` master, which stays a pay-grade/title.

**Why the masters are load-bearing, not decorative:** with full labor costing (§3.6), the
workstation's `machine_hour_rate` and operation's `default_minutes` are cost/variance inputs, and
`trades` is the assignment filter. These are the closest analogs to ERPNext's **Operation** +
**Workstation** doctypes — kept deliberately flat (no routing-sequence engine, no capacity calendar).

### 3.3 Material issue to production (Stores → WIP) — structured consumption

**Read side built:** a `BOM` tab now lives in the Job Card workspace — cross-project picker, then
the existing `BomTable`/`getProjectBom` (§5a), field-scoped to Production's real ownership
(`issued_ref`/`received_ref`, via `BOM_FIELD_OWNERS.Production` — the same list the PATCH route
already enforces server-side, so this can't drift from it). No new BOM UI was built; this is a new
place to reach the existing one, cross-project instead of per-project. Answers the standing question
of *"what's actually arrived for this project before I start a job card"* directly from Production's
own workspace.

**Write side (structured consumption) still free text today.** `bom_items.issued_ref` / `received_ref`
remain free text — the WIP/consumption blind spot. Replace the record side with a structured issue
against a job card.

`material_issues` — `id`, `bom_item_id` → `bom_items`, `job_card_id` → `job_cards` (nullable),
`qty` (real number), `issued_by`, `issued_at`, `notes`.

Feeds a true material-consumed figure per subsystem and closes the Stores→Production handoff.
Maps to ERPNext's **Stock Entry (Material Transfer for Manufacture)**, collapsed to the one
movement we need (issue to WIP), with no separate warehouse ledger.

### 3.4 Production progress rollup → milestone + Executive forecast

`getFabricationProgress(projectId)` is built (`lib/data.js`) — job-card completion per milestone,
now correct by construction since job cards are milestone-scoped (§3.1), not just approximately.
**Not yet wired into any UI** — not the project page, not the Executive Delivery Forecast. Purely a
display gap; the underlying data is real and ready.

### 3.5 Rework / rejection loop

`qc_records` already exist (§5b). A **QC fail** spawns a **rework job card** against the same
milestone. `rework_of_job_card_id` (self-FK) and `qc_record_id` are on `job_cards`
(`lib/db.js`) — schema built, but there's no "create rework card" button on a failed `qc_records`
entry yet, and the New Job Card dialog doesn't expose either field in its UI (the API accepts them;
nothing currently sends them).

**Surfaced by the Hydro Test department move (this round):** moving `hydro_test`'s milestone
ownership from QC to Production (`lib/milestones.js`, plus a migration for already-seeded projects)
only moves who schedules/closes the *milestone*. The actual test **record** — pass/fail, cert
number — still lives in `qc_records`, still QC-gated (`requireDepartment(user, 'QC')` in
`app/api/qc-records`). Whether Production should also get write access there, now that they own the
milestone, is a real open decision — not resolved here, flagged for whoever owns that call next.

### 3.6 Labor costing (the one place we go heavy)

Decision on record: job cards capture **full labor costing** (time × rate → cost).

- **Rate is HR-owned, Production-consumed.** The person's cost rate derives from HR (`employees`
  payroll — `ctc`/salary structure, or a dedicated `cost_rate_per_hour` on `employees`). Production
  does **not** own pay rate — consistent with §2.5 (pay lives in HR, work lives in Production).
- **Machine rate** is Production/finance-owned on `workstations.machine_hour_rate`.
- **Card labor cost** = Σ(`job_card_time_logs.minutes`/60 × employee cost rate, per row) + optional
  (card duration × `workstation.machine_hour_rate`).
- **New rollup:** labor cost per subsystem → per project, beside material cost (BOM + PO). Yields
  **fabrication cost = material + labor** per project — a number nothing in the system produces
  today, and the one a PM actually wants.

Analog of ERPNext's operation-time + workstation-rate → **operating cost** on the Work Order, but
derived from real captured hours rather than a planned routing.

---

## 4. Tasks are NOT Job Cards — two different layers

A common confusion worth stating explicitly for the reviewer:

| | **Tasks** (exists today, §3a) | **Job Cards** (this doc) |
|---|---|---|
| Assigned to | logged-in **department heads** (`users`, by username) | **shop-floor workers** (`employees`, by trade) |
| Altitude | coordination / supervisor to-do calendar | actual execution unit |
| Carries | title, due date, status | operation, workstation, qty, hours, labor cost, pass/fail |

They coexist: the foreman has *tasks*; the welders have *job cards*. Do not merge them.

---

## 5. Subcontracting — a flag, not a module

Subcontracting is **occasional**, so it is modeled as `is_outside` (bool) + `outside_vendor`
(free text) on the job card. No send/return material tracking, no subcontract PO entity of its own.
If an outside job needs a purchase order, it routes through the existing Procurement system (§5c).
Revisit only if outside work becomes routine.

---

## 6. What we deliberately do NOT build (YAGNI for ETO)

| ERPNext feature | Why skipped |
|---|---|
| **MRP / Production Plan** | Demand-driven planning; we're project-driven — the BOM is the plan. |
| **Work Order as a planning doc** | Planning = Master BOM + milestones; a job card is the execution unit. No separate planning order. |
| **Multi-level BOM explosion / BOM costing tree** | Our BOM is a flat per-subsystem materials list, not a nested make-to-stock tree. |
| **Finite-capacity scheduling / operations Gantt** | One-off custom jobs; milestone tracker + planned dates suffice. |
| **Repetitive / batch manufacturing, job-card auto-split by qty** | We don't make N identical units. |
| **Dedicated subcontracting module** | Occasional only → flag on the job card (§5). |
| **Downtime / OEE / machine maintenance logs** | No evidence of need yet; revisit if utilization becomes a constraint. |

---

## 7. Data model (proposed additions)

```
employees (HR single master)              (§2.5 — the one people table; workers with dept=Production, employee_type='worker')
  employees.trade_id → trades             (Production-owned skill; replaces free-text workers.trade)
  employees.cost_rate_per_hour            (or derived from payroll — HR-owned, consumed by costing)

projects ──< job_cards                     (the shop-floor execution unit)
job_cards ──< job_card_time_logs           (multiple sessions per worker per card; employee_id + from/to + qty)
job_cards ──< job_card_consumables         (welding rods, gas, discs — free text, no stock ledger)
job_cards >── operations                   (what step; master, optional standard time)
job_cards >── workstations                 (where / machine; master, carries machine_hour_rate)
job_cards >── bom_items (nullable)         (single-line scope; else scoped by section)
job_cards ──< material_issues              (Stores → WIP consumption, real qty)
job_cards ──> job_cards (rework_of, self)  (QC-fail rework lineage)
job_cards >── qc_records (nullable)        (link a card back to the failing test)

trades (id, name, active)                  (Production-owned skill master — distinct from HR designations)
```

All new columns via the `addColumn()` migration helper in `lib/db.js` (existing convention, no
one-off `ALTER TABLE`s). All create/edit/delete write `usb_audit` rows via shared `audit()`.

---

## 8. ERPNext mapping summary (for the reviewer)

| ERPNext Manufacturing doctype | Shanti equivalent | Notes |
|---|---|---|
| BOM | Master BOM / PMB (`bom_items`, §5a) | Flat, per-subsystem, import-driven. Existing. |
| Work Order | *(none — intentionally)* | Execution is the Job Card; planning is BOM + milestones. |
| **Job Card** | **`job_cards` (new)** | Core. Carries time + labor cost + rework lineage. |
| Operation | **`operations` (new)** | Flat master, optional standard time. |
| Workstation | **`workstations` (new)** | Flat master, carries machine-hour rate. |
| Routing | *(none)* | Operation+workstation on the card; no sequence engine. |
| Employee | **`employees`** (existing HR master) | Shop-floor workers are `employee_type='worker'`. |
| Quality Inspection | `qc_records` (§5b) | Existing. Fail → rework job card. |
| Stock Entry (Mtl Transfer for Mfg) | **`material_issues` (new)** | Collapsed to issue-to-WIP only. |
| Production Plan / MRP | *(skipped, for now — §6)* | ETO — BOM is the plan. Revisit after the rest is built. |
| Subcontracting | `is_outside` flag on job card | Occasional only. |
| Job Card Time Log | **`job_card_time_logs` (new)** | Multi-segment, employee + from/to + qty — adopted directly from ERPNext's shape. |
| Secondary/consumable items | **`job_card_consumables` (new)** | Lighter than ERPNext's — free text, no Item master. |
| Is Paused | **`job_cards.is_paused` (new)** | Adopted directly — cheap, real. |
| Multi-company (two entities) | *(gap, not fixed here — §2.6)* | `projects` needs a `company` column; job cards would just inherit it. |
| Downtime / OEE | *(skipped)* | Not needed yet. |

---

## 9. Honest completeness assessment ("is Production 10/10 after this?")

**No — and 10/10 is the wrong target.** With everything above (job cards, trade-based assignment,
material issue, labor costing, rework, the roster unification), Production has a **complete
*operational* module — roughly 8/10**, and that is the right place to stop for a first release.

The remaining ~2 points are **IBR / statutory traceability depth**, which is specialized and
overlaps QC's domain:

- Welder qualification records (WPS/PQR), and welder-to-weld traceability
- Weld maps, per-joint NDT/radiography tracking
- Material traceability (heat number ↔ test certificate ↔ BOM line)

These are blocked on the same client statutory sample files as the QC statutory-forms roadmap, and
building them before the operational core is validated on the shop floor is over-reach. **Ship the
operational 8, let the floor use it, then decide if the statutory 2 is worth it.**

---

## 10. Suggested build order

1. **Roster unification (§2.5)** — Production Workers UI reads/writes `employees`; retire the
   `workers` write path. Add `trades` master + `employees.trade_id`. *(Foundational — do first.)*
2. `operations` + `workstations` masters.
3. `job_cards` + `job_card_time_logs` + `job_card_consumables` + Kanban UI + Production/PM gating.
4. Cost rate wiring (`employees` cost rate + `workstation.machine_hour_rate`) + labor-cost calc.
5. `material_issues` (Stores→WIP) + structured consumption display.
6. Fabrication-% rollup → Production milestone + Executive forecast; labor+material cost rollup.
7. Rework loop (QC fail → rework card lineage).
