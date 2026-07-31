# Shanti Ops — Manufacturing Operations + Device/Data Security Platform

**This is the single canonical system document.** If you are picking up this project cold (a new
AI session, a new developer, or re-orienting after time away), read this file first — it should
be enough to understand what exists, how it fits together, and where the known gaps are, without
re-deriving anything from the code. Two independent platforms share one app, one database, and one
set of user accounts:

1. **Operations platform** (§1–8) — runs a boiler order from design to commissioning, replaces the
   manual packing list.
2. **Approval / device-security platform** (§9–16) — a Windows agent + browser extension that
   blocks USB drives, CDs/DVDs, phones, and websites on employee machines until a manager approves,
   via the same dashboard.

Everything in this file reflects the **current, working build** as of 2026-07-31 (post: **tickets
now close the loop with the milestone tracker instead of just notifying about it** — resolving a
`handoff` ticket stamps the receiving milestone's Start, resolving a `rework` ticket against an
already-closed milestone reopens it and tells whoever it had already been handed off to that the
work isn't finished anymore, every ticket status change is logged to the audit trail, and the
**Tasks calendar (formerly Production-only) now works for every department** — tickets pill on it
as a third source alongside tasks/milestones, with an open/resolved count strip — see §3a/§3b.
Previous round: a cross-department **Tickets + notification bell** system — automatic handoff
tickets when a milestone closes, plus hand-raised rework/request tickets, an in-app bell with a
subtle chime; **Production's own Today calendar and Workers daily sheet**, a shop-floor view
separate from the milestone tracker; the production **login page split** into a clean `/login` for
real users and a password-gated `/d-login` demo picker, plus `DEMO_USERS` so demo accounts skip the
device-setup gate (§2c); and self-registration **locked down to department heads only** — the
"Project Manager" option is gone from both the form and the server (§2a). Round before that: QC
test records — the first department-specific module built for QC instead of a generic milestone
list (§5b); a self-service device-setup gate that blocks a functional head's login until their
machine is enrolled, no admin file-relay needed (§2a); contextual "i" help popovers in Approvals
reusing the `/help` content (§2b); the Chrome extension actually published and force-install wired
(§14); and a `CardHeader`/`CardAction` layout bug fixed across five components — see §18. Round
before that: multi-project customer logins + "My Orders", role-aware `/help`, self-registration
with an approval hierarchy + new `executive` role, the onboarding roster in Approvals → People, and
extending the audit trail to the operations platform's core mutations — see §16.

---

# Part A — Operations platform

## 1. What it is — an operational command center, not a spreadsheet

Exception-driven and **role-aware**: it surfaces what needs attention and shows each user the right
altitude. Three experiences share one database:

| View | Who | Answers |
|------|-----|---------|
| **Operations** | functional heads, PM | "What needs doing today?" |
| **Executive** | PM | "Where are the risks and when do we ship?" |
| **Customer Portal** | the customer | "How is my order progressing?" |

## 2. Roles & access (department-based)

Three internal roles (PM tier: admin/manager/**executive**, all `isPM()` — see §2a for why a third
PM-tier role exists) plus the external customer, plus a fifth role used only by the security
platform (§9). Access for functional heads is scoped **per department**, not per project — the
single access-scoping unit. A customer is scoped to **one or more projects** (`users.project_ids`
CSV, same idiom as departments) — a company with several orders gets one login and a "My Orders"
landing page (`/portal`), not one login per order.

**Departments:** Design, **Engineering** (owns the Bill of Materials — no milestones of its own),
Procurement, **Stores** (owns the BOM's GRN/receipt columns — also no milestones), Production, QC,
**Dispatch** (owns Packing), Installation.

| Login | Password | Role | Access |
|-------|----------|------|--------|
| `admin` | `admin123` | **PM** (`admin`) | Everything — all projects, all departments. Owns project creation. Only role that can register agent machines. |
| `manager` | `manager123` | **PM** (`manager`) | Same as admin for the ops platform; both are "PM" — see `isPM()` in `lib/auth.js`. |
| `executive` | `executive123` | **PM** (`executive`) | Same full surface as admin/manager, plus top of the approval hierarchy — approves Project Manager registrations that a `manager` cannot (see §2a). |
| `design_head` | `design_head123` | **Functional Head** (`operator`) | Design department only (demo). |
| `engg_head` | `engg_head123` | **Functional Head** (`operator`) | Engineering department only (demo) — owns the BOM item definitions. |
| `procurement_head` | `procurement_head123` | **Functional Head** (`operator`) | Procurement department only (demo). |
| `stores_head` | `stores_head123` | **Functional Head** (`operator`) | Stores department only (demo). |
| `production_head` | `production_head123` | **Functional Head** (`operator`) | Production department only (demo). Also the employee role for the security platform. |
| `qc_head` | `qc_head123` | **Functional Head** (`operator`) | QC department only (demo). |
| `dispatch_head` | `dispatch_head123` | **Functional Head** (`operator`) | Dispatch department only (demo). |
| `installation_head` | `installation_head123` | **Functional Head** (`operator`) | Installation department only (demo). |
| `asian_brown` | `asian_brown123` | Customer | One order (SB-1018), read-only, business language. |
| `hkm_charitable` | `hkm_charitable123` | Customer | Three orders (SB-1103/04/05) — lands on **My Orders** (`/portal`), one card per project. |
| `virchow_biotech` | `virchow_biotech123` | Customer | One order (STF-IBR-052). |
| *(agent)* | — | `agent` | Not a human login — a machine-scoped JWT issued when a device is registered. See §11. |

New accounts start **`pending`** (self-registered via the login page's "Request access" — see §2a)
and cannot log in — `pending: 1` on `users` — until a PM approves them; the demo accounts above are
all pre-approved (`pending: 0`).

- **PM** creates projects, owns the schedule (planned dates), edits any milestone, uploads BOMs, and
  manages access. Lands on **Executive**. Top nav: **Executive · Operations · Projects ·
  Approvals** — the Departments picker, Settings, theme toggle, and Logout all live in the **cog
  dropdown** (no standalone Packing tab; reached via Departments → Dispatch).
- **Functional Head** does the data entry operators used to. Scoped to their granted department(s):
  they only see/act on milestones in those departments, get a **read-only** Projects list (no
  "+ New Project"), and see **Packing** only if granted **Dispatch**. A head assigned more than one
  department gets **one tab per department in the top nav**. Empty state if unassigned: "No
  departments assigned yet — contact your PM."
- Access is granted by the PM in **Settings → Access Matrix** (heads × departments grid) alongside
  **User Management** (create / deactivate heads). Enforced at the route/API level via
  `requirePM` / `requireDepartment` / `canAccessDepartment` in `lib/auth.js`.
- **The same two roles carry over to the security platform** (§9): PM = approver, operator =
  employee whose machine gets the agent. No separate account system.

## 2a. Onboarding & self-registration

Anyone can request an account from the **login page** ("Request access") — no admin has to create
it first. `POST /api/register` (public route) takes a display name, username, password, and one or
more **departments**; the row is always created as a **department head** (`role: 'operator'`),
never a PM. **Project Manager was removed as a self-registration option** — someone once
self-registered as a PM, which grants full access with no device-setup gate at all. The form no
longer offers the choice, and the server hardcodes `role = 'operator'` regardless of what's sent —
PM accounts are created **internally only**, no public route makes one. The row is inserted with
`pending = 1` and cannot log in (`/api/login` 403s with "awaiting approval") until approved.

**Approval hierarchy** (`canApproveUser` in `lib/auth.js`): `admin`/`executive` approve anyone;
`manager` approves department heads and customers, but **not** another manager or a PM-tier
registration — that's what `executive` is for. Approving/rejecting is audited via the shared
`usb_audit` table (`user_registered` / `user_approved` / `user_rejected`), same as every other
approval category.

**Approvals → People tab** (PM-only, `components/PeoplePanel.jsx`) is where this happens:
- **Pending Registrations** — see the requested role/departments (adjustable before approving),
  Approve or Reject.
- **Onboarding Roster** — closes the gap noted in the old §13: every internal person (not just
  already-enrolled machines) shows with a derived status — online / enrolled-offline / enroll-file-
  sent / no machine yet — and admin/executive can register a machine, then get **both** an Enroll
  file button and an Installer button (public GitHub release asset) right there. Neither downloads
  anything for the employee — see the gate below for how they actually get set up.

**Self-service device-setup gate** (`app/layout.js`, `components/DeviceSetupGate.jsx`): once a PM
registers a functional head's machine, that head is on their own — the admin never sends files. The
*next* time that head logs in, the root layout checks `lib/data.js`'s `getMyMachine()`; if their
machine has no `enrolled_at` **and** no `last_seen`, the entire app is replaced with a blocking
"Welcome to SB Ops" screen showing their Enroll file + Installer downloads and plain-language setup
steps — no Nav, no other route reachable, just a logout escape hatch. It polls every 5s and unlocks
itself the instant the agent's first check-in lands. Scoped to the `operator` role only — PMs are
deliberately never gated, since they're the ones who have to register a head's machine in the first
place; gating them too would be a lockout with no way out.

## 2b. Help — role-aware guide

The **"i" icon** next to the cog (top nav; a plain link on customer portal headers, which have no
Nav) opens **`/help`**. Content is a plain data structure (`components/help-content.jsx` —
`PM_GUIDE`, `HEAD_GUIDES` keyed by department, `CUSTOMER_GUIDE`), rendered as numbered step cards;
adding a new feature later is one entry in the relevant array, no new page. A PM sees a full system
tour (projects → tracker → Master BOM → packing → approvals → onboarding → settings); a head sees
one section per **granted** department (Engineering/Procurement/Stores/Production/etc.); a customer
sees how to read their order.

The once-empty Engineering department view is now a real workspace: the **Master BOM** (§5a) —
Engineering owns the item definitions, and Procurement / Stores / Production each edit only the
columns their department owns. The Operations page shows BOM-owning heads a "Master BOM" card
(projects with missing BOMs or open items) alongside the milestone attention list.

**Contextual help, without leaving the page** (`components/InfoPopover.jsx`): Approvals → People
(Onboarding Roster) and Approvals → Devices (Pending Approvals) each carry a small "i" button —
`CardAction` in the card header — opening a popover with the exact walkthrough for that screen
(onboarding steps, OTP approval steps), pulled from the *same* `PM_GUIDE` array `/help` renders.
One content source, two places it surfaces; adding a step to the guide updates both automatically.

## 2c. Login pages & demo access

`/login` is the plain production sign-in page — username/password + "Request access", nothing
else. The full demo-account picker (tap a name to auto-fill, grouped by Demo/Heads/Customers) lives
at **`/d-login`** instead, gated behind a throwaway password prompt (`app/d-login/page.js`'s
`DemoGate` — `sessionStorage` + a fixed password). It's a speed bump, not real security — anyone
reading the JS bundle can find it — but it keeps a wall of other people's demo credentials off the
screen a real department head sees.

**`DEMO_USERS`** (`lib/auth.js` `isDemoUser`, env-var CSV, e.g. `production_head,qc_head`) lets
named accounts skip the device-setup gate (§2a) entirely, so a demo walkthrough never gets stuck on
"your machine isn't registered yet." It's an env allowlist, not a DB column — unset it to remove
the escape hatch completely.

## 3. Operations view (daily execution)

- **Creating a project seeds its full milestone chain** (`createProjectMilestones` in `lib/db.js`,
  called from `POST /api/projects`) with planned dates laid out from the order date (or today) —
  every milestone starts `pending`, no fabricated data. The Milestone Tracker, department tabs, and
  health badge are live from the moment a project exists; the PM adjusts dates/assignees from there.
- **PM** sees *Today's Factory* (everything); a **head** sees *My Work* (their department(s) only).
  Both lead with **summary chips** (overdue / blocked / due-soon counts).
- The Departments picker (PM, in the cog) and department tabs (multi-department head, in the top
  nav) filter this view via `?dept=`.
- **Special case — Dispatch:** picking the Dispatch department renders the **Pending → Ready →
  Dispatched packing board** (`components/DispatchBoard.jsx`) instead of the generic attention
  list, since packing lives entirely under Dispatch.

### Project page — top to bottom

The layout adapts to who's looking:

1. **Row 1 — identity + attention (two columns):** project header (name, status, "why is this
   delayed?" blocker callout, PM/value/updated, Customer-view link) beside **Needs Attention**
   (only the milestones that matter right now, scoped to the viewer's department if they're a head).
2. **Row 2 — Milestone Tracker:** the same component as the Executive dashboard
   (`components/PortfolioDelayTimeline.jsx`), scoped to this one project — its stages as a
   connected, color-coded bar with a today-marker, expandable into a per-stage pill chain (status,
   delay delta, actual dates), cumulative dispatch delay at the end.
3. **Row 3 — department work**, which differs by role:
   - **PM/admin** see an **all-departments tab strip** (underline style,
     `components/ProjectDepartmentTabs.jsx`) — one tab per department, with a red dot on any
     department that has an overdue/blocked milestone.
   - **Functional head** sees their own department(s) as stacked sections (no tabs) — each is a
     `components/DepartmentPanel.jsx`.
   - Each department's panel (`DepartmentPanel`) shows: that department's milestones via
     `MilestoneBoard`/`MilestoneCard` → edit drawer (`MilestoneDrawer`), plus a department-specific
     panel where relevant — **Engineering → Bill of Materials** (`BomPanel`), **Dispatch →
     Packing** (`PackingPanel`, this project's packing lists + generate-from-BOM).
   - **Milestone edit drawer:** PM gets the full editable form (all fields) + a bulk spreadsheet
     grid. **Functional heads get a reduced drawer** — schedule (planned dates) is read-only, with
     two actions: **Start** (stamps actual start) and **Close** (stamps actual end); closing late
     prompts for delay category + reason.

### Status colours

`Not started` (gray) · `On track / In progress` (blue) · `Running late` (amber) · `Blocked` (red) ·
`Closed` (green). Each milestone's colour merges its human status with its deadline automatically
(`lib/sla.js`, `lib/delay.js`).

## 3a. Tasks — every department's calendar, plus Workers (Production only)

Every department runs part of its day off a calendar, not just the milestone tracker, so any head
with at least one granted department gets a **Tasks** tab (`hasTasks = departments.length > 0` in
`components/Nav.jsx`) — generalized from an earlier Production-only build (ported from the sibling
project **savistar-ops**). **Workers stays Production-specific** — a separate, stricter
`inDepartment(user, 'Production')` gate, unchanged, since it's a shop-floor attendance concept the
other departments don't have.

⚠️ **Verification gap, check first next session:** live testing covered Design, Engineering
(combined multi-department view) and Production only. A grep for hardcoded `'Production'` across
`Nav.jsx`, `ProductionToday.jsx`, `app/production/page.js`, and the `api/production/tasks/*` write
path turned up none outside the intentional Workers/BOM/worker-sheet call sites — so the code
*reads* generic — but Procurement, Stores, QC, Dispatch, and Installation were never actually opened
in a browser as this feature. Confirm the Tasks tab renders and behaves correctly for those before
trusting this section.

- **Tasks** (`/production`, `components/ProductionToday.jsx` — route name is legacy, the nav label
  and page title both say "Tasks") — Month/Week/Year calendar merging **three** sources per day:
  **milestones** (`planned_end`), **tasks** (a lightweight `tasks` table:
  `title, due_date, status, department, assigned_to`, for to-dos not tied to any project's
  milestone chain), and **tickets** (pilled on `due_date`, falling back to the day raised when
  there's no due date — see §3b). `getDepartmentCalendar(departments, from, to)` in `lib/data.js`
  takes an array so a multi-department head sees a **combined view by default**, narrowed to one
  via the same `?dept=` nav-tab idiom Operations already uses (`deptFilter`/`deptsToShow` in
  `app/production/page.js`, mirroring `app/page.js`). Combined-view pills prefix with
  `[Department]`. A "To dos" rail lists open tasks and open tickets regardless of which day is
  selected; an open/resolved ticket count strip sits under the calendar (open = live backlog,
  unbounded by view; resolved = bounded to the visible Month/Week/Year range, reusing
  `monthGridBounds`/`weekBounds`/`yearBounds` — no new range logic). PMs do **not** get this tab —
  same exclusion as before, just keyed on "any granted department" instead of "Production
  specifically"; a PM-oversight cross-department view is deferred (§8), same status as the combined
  multi-department dashboard.
- **Workers** (`/production/workers`, `components/WorkersPanel.jsx`, Production-only) — a **Home**
  sub-tab (headcount + today's attendance %, derived from props already on the page — no new query)
  alongside the daily attendance + work-assignment sheet for shop-floor workers who **never log in
  and have no `users` row** (`workers` table: name, trade, department, never deleted, only
  deactivated). One row per worker per day (`worker_days`, `UNIQUE(worker_id, date)`) —
  present/half/absent, optionally linked to a project + milestone they worked on.
- **Landing tab:** `roleHome`/`postLoginHome` (`lib/auth.js`) still send a Production member to
  `/production` after login instead of `/` — unchanged, deliberately not generalized to every
  department yet.

## 3b. Tickets & notifications — cross-department handoff, now closing the loop

Closing a milestone used to leave the *next* department with no signal it was their turn, and
Engineering/Stores (who own zero milestones — they work through the BOM) had no place in the
handoff chain at all. Tickets fixed the signal; a later round (this one) fixed the *loop* — until
now, resolving a ticket never touched the milestone it was about, so the tracker could show
"Closed" on a milestone that had actually been sent back for rework.

- **Automatic handoff:** closing the *last* milestone in a department's run (`lib/handoff.mjs`
  `handoffTarget`, reading each project's own `milestones` rows ordered by `sort_order` — not the
  static template, since a PM can reassign `department` per row) fires a `handoff` ticket to
  whichever department the next milestone belongs to, with `tickets.milestone_id` pointing at that
  **receiving** milestone. Hooked into the **one** milestone write path
  (`app/api/milestones/[id]/route.js` PATCH — both the drawer and the bulk-edit grid funnel through
  it) by comparing before/after DB state, not the request body. Idempotent via `tickets.source_key`
  (`'handoff:<closed milestone id>'`, `UNIQUE`, `INSERT OR IGNORE`) — reopening and reclosing a
  milestone never double-fires (see the reopen note below for the real consequence of this).
- **Hand-raised tickets:** any department can raise a `rework` (sent back) or `request` (direct
  ask) ticket to any other department. `POST /api/tickets`; `kind: 'handoff'` is rejected if a
  client sends it — only the server ever creates those. A `rework` ticket **must** name the
  milestone it's about (`components/TicketsPanel.jsx` — the selector only appears, and only offers
  `rework` as a kind at all, when raised from a project context, since a milestone selector needs a
  project to scope it to; the Operations-level ticket card has no project and so only offers
  `request`). The server re-validates the milestone actually belongs to the named project and
  department before accepting it.
- **Resolving a ticket now has real side effects** (`app/api/tickets/[id]/route.js` PATCH,
  previously a pure UPDATE with none):
  - Every status transition is logged to the app's generic audit trail
    (`lib/usb.js` `audit('ticket_status_change', ...)` — the table is named `usb_audit` but is
    already reused app-wide, see §16).
  - Resolving a **handoff** ticket stamps the receiving milestone's Start
    (`status='in_progress', actual_start=today()`, same fields the drawer's own Start button
    writes) — guarded so it's a no-op if someone already started it by hand. No re-derivation
    needed: `ticket.milestone_id` already *is* the receiving milestone, captured at handoff-creation
    time using the live per-project chain above.
  - Resolving a **rework** ticket against a milestone that's already Closed **reopens** it —
    `actual_end` cleared, `status='in_progress'`, and a new `milestones.reopened_at` timestamp
    stamped so it reads honestly as "Reopened" everywhere `effectiveStatus()` renders a status label
    (`lib/sla.js` — same severity tier as `in_progress`/`overdue`/etc., not a new status code, just
    an honest label suffix). If that milestone had already fired its own handoff downstream
    (`source_key = 'handoff:<this milestone id>'` still exists), the receiving department gets a
    new notification: the work they were told was ready, isn't anymore.
  - **Known limitation:** because `source_key` is `UNIQUE`, redoing the work and re-closing the
    reopened milestone does **not** re-notify the downstream department a second time (the
    `INSERT OR IGNORE` silently no-ops on the same key). Not fixed — flagged for whoever picks up
    the "notify on resolution" / overdue-notification work next (see §8).
- **Notifications** fan out one row per recipient (`notifications` table) to everyone in the
  target department (`lib/tickets.js` `notifyDepartment`, matched via `parseDepartments` — PMs are
  excluded by construction since their `departments` column is NULL). The acting user is excluded
  from their own notification. Still **not** built: notifying the original raiser when their own
  rework/request ticket is resolved, and overdue-ticket notifications — both explicitly next, not
  part of this round (see §8).
- **The bell** (`components/NotificationBell.jsx`, mounted in `Nav.jsx`) polls
  `GET /api/notifications` every 20s with a plain `fetch` — deliberately not `router.refresh()`,
  since Nav is mounted on every page and that would re-fetch every page's server data on a timer.
  Chimes (`lib/beep.js`, WebAudio, no audio file committed) only when the unread count increases,
  never on first load; the mute toggle persists to `localStorage.notifySound`. No standalone
  "Notifications" header in the popover; "View all" and the no-project fallback link to
  `/notifications` (below), not a `/tickets` route (removed — see below).
- **Three surfaces**, all reading `getTickets()` (or the calendar's date-bounded variant in
  `getDepartmentCalendar`): a **Tickets card inside each department's project panel**
  (`components/TicketsPanel.jsx`, wired into `DepartmentPanel.jsx`) where the work already lives; a
  **department-scoped ticket section on Operations** (`app/page.js`, same `deptFilter`/`deptsToShow`
  pattern as the rest of that page — the old standalone `/tickets` route is gone, deleted along with
  its nav entry); and **ticket pills on the Tasks calendar** (§3a) which link back to the Operations
  ticket section rather than opening any new detail UI. A full **`/notifications` page** (not in
  nav, reachable only from the bell) lists the fuller history generically off `kind`/`title`/`body`
  — no per-kind branching, so a future notification kind needs no UI change.
- **Deliberately deferred, not built yet:** notify-the-raiser-on-resolution and overdue-ticket
  notifications (next, see §8); a mobile bottom-bar fix for heads with several department tabs;
  BOM-received / QC-fail as new notification triggers (blocked on BOM/QC refinement).

## 4. Executive view

Order, top to bottom:

1. **KPIs** — projects, healthy, delayed, critical, completed, average delay (days), value in
   progress.
2. **Milestone Tracker** — the portfolio-wide version of the project-page tracker: one row per
   project, stages as a connected bar, today-marker, cumulative delay, expandable per-stage detail.
3. **Top Risks** (worst blocker per project, ranked by dispatch impact) + **Delayed Because** (by
   category), side by side.
4. **Delivery Forecast** — one row per project: Project · Customer · Health · Progress % · Current
   stage · Delay (±days) · Value · Est. Dispatch.

## 5a. Master BOM (PMB) — the department-scoped materials tracker

The client's real workflow lives in hand-made **"Project Master BOM"** Excel workbooks
(`SB-1104-PMB.xlsx`…): one workbook per customer project, one sheet per subsystem (BOILER, ID FAN,
CHIMNEY…), one row per material with procurement lifecycle columns explicitly owned by departments
("by DESIGNS" / "PURCHASE DEPT." / "STORES DEPT." / "PRODUCTION DEPT."). The PMB module imports
those workbooks and replaces the shared spreadsheet:

1. **Import** (Engineering or PM, project page → Engineering panel): upload the `.xlsx` →
   server-side tolerant parse (`lib/pmb.mjs` — keyword header detection handles the several
   hand-made layouts, including two-row headers and split "PO No. | Date" column pairs) → a
   **mandatory preview** (per-sheet counts, ignored columns, skipped rows) → confirm. Nothing is
   written without a human looking at the preview. Re-import is an explicit, destructive
   **Replace** (warns about packing links). The original `.xlsx` is stored whole in `bom_imports`
   — that row *is* the revision record, downloadable via `/api/bom-imports/[id]/file`.
2. **After import the app owns the data** (decided): departments update statuses in the app, no
   Excel re-sync. Assembly-heading rows become `group_label` on the items below them, so every
   `bom_items` row stays a packable item and the packing reconciliation (§5) is untouched.
3. **Field-level department scoping** — the module's trust boundary, enforced in
   `PATCH /api/bom-items/[id]` via `BOM_FIELD_OWNERS` (`lib/bom-fields.mjs`), not just hidden in
   the UI: Engineering (+PM) edit the definitions (description/spec/size/make/qty + add/delete),
   Procurement edits status/PR/PO, Stores edits GRN/quantities/BQ-TC, Production edits
   issued/received. A forged request gets a 403 naming the offending keys.
4. **Views:** one shared `BomTable` (grouped by sheet + assembly, client-side search + status
   filter — the big project has 400+ rows) rendered in the Engineering panel and in the
   Procurement/Stores/Production department panels; `BomProgress` per-section rollup on the
   project page; a **BOM %** column in the Executive Delivery Forecast; a "Master BOM" open-items
   card on Operations for BOM-owning heads.
5. **Audit:** imports, replaces, item adds/edits/deletes all write `usb_audit` rows
   (`bom_import` / `bom_replace` / `bom_item_add` / `bom_item_edit` / `bom_item_delete`) via the
   shared `audit()`.
6. **Parser self-check** (no JS test framework, same precedent as the agent's `--selftest`):
   `node lib/pmb-selfcheck.mjs` (synthetic fixtures) or point it at a real workbook to print
   per-sheet mapping/counts/skips.

Deliberately **not** built (v1 decisions): document management for drawings/IBR/QC certificates,
release/approval workflow for BOM revisions, Excel export/back-sync, in-app BOM authoring from
scratch (the add/edit/delete APIs are 90% of it — natural v2), supplier/lead-time analytics.

## 5. Packing & BOM (the digital packing list)

The Dispatch department board: **Pending → Ready → Dispatched**. BOM-driven flow:

1. **Engineering (or PM) uploads a BOM** — normally the PMB import above; a paste-rows fallback
   (Description, MOC, Size/Spec lines) remains for non-Excel BOMs — via the Engineering panel on
   the project page.
2. **Dispatch generates a draft packing list** from still-pending BOM lines (Engineering tab's BOM,
   or the Dispatch tab's own panel) — `Material description`, `MOC`, `Size/Spec` prefilled;
   `IBR No.`, `Item code`, `Box No.`, `Qty`, `Make` left for the Dispatch head to fill.
3. On approval (status ≥ Ready), rows feed the board.
4. **Reconciliation:** any BOM line not yet on an approved packing list stays **Pending** and can
   seed a new list later (partial dispatch). Each packing item links back via `bom_item_id`.
5. **Real PDF generation** (`@react-pdf/renderer`): "Generate PDF" streams a document matching the
   SB-IBR-1018 layout (company header, buyer/invoice/DC block, item table, 7-day declaration,
   Stores/Production/QC/Management sign-off). A separate **Pending-list PDF** exports unpacked lines.

## 5b. QC test records

QC used to get nothing but the generic milestone list every other department gets — this closes
that gap. A project-scoped, QC-owned log (`qc_records` table, `components/QcPanel.jsx`, rendered
only on the QC department tab): test type (hydro test, radiography/NDE, material test certificate,
or freeform), reference/cert number, inspector, test date, notes, and a pending/pass/fail result
QC can flip inline. Whole-row department ownership like `packing_lists` — no field-level split
like the BOM's, since no other department writes part of a QC record. Full CRUD
(`app/api/qc-records/*`) gated to QC + PM, audited the same as everything else.

## 6. Customer Portal (read-only, external)

- **My Orders** (`/portal`) is the landing page for every customer — one card per project they own
  (`users.project_ids` CSV, `canAccessProject()` in `lib/auth.js`), even when they only have one.
  Clicking a card opens the per-order view.
- Business-language **phase stepper** (Order Received → … → Commissioning), overall %, est. dispatch.
- A packing-list link that opens a **read-only document view** (Print / Generate PDF only) — no
  editing, and only once the list is past draft (≥ Ready). Enforced at the route and API level.
- A customer only ever sees their own project(s) — every portal/packing route checks
  `canAccessProject`, never a bare `project_id` equality.

## 7. Operations-platform data model

```
projects ──< milestones                         (flat — design → commissioning, no unit layer)
projects ──< bom_items                           (the Master BOM — §5a)
projects ──< bom_imports                         (one row per PMB upload: revision + the original .xlsx BLOB)
projects ──< packing_lists ──< packing_items     (packing_items.bom_item_id → bom_items, reconciliation)
projects ──< qc_records                          (§5b — QC-owned test log, one row per test)
projects ──< tickets ──< notifications           (§3b — cross-department handoff; notifications fan out one row per recipient)
milestones ──< tickets                           (a handoff ticket's milestone_id is the receiving milestone; a rework ticket's is the one it reopens on resolve — §3b)
tasks                                            (§3a — every department's own to-dos now, not tied to a project/milestone; department is a real per-row column, not a Production-only default)
workers ──< worker_days                          (§3a — Production-only shop-floor people with no users row; one attendance row per worker per day)
users (role + departments CSV + project_ids CSV [customer scoping, one-or-more] + pending flag)
```

`bom_items` carries the spreadsheet-mirror columns — `section` (sheet), `group_label` (assembly
heading), `make`, `qty_text`, `purchase_status` (PENDING/TRANSIT/CLOSED/RECEIVED), and free-text
refs `pr_ref`/`po_ref`/`grn_ref`/`grn_qty_text`/`pending_qty_text`/`bqtc_ref`/`issued_ref`/
`received_ref`/`remarks`, plus `import_id → bom_imports` (null = pasted/added in-app). All refs
are deliberately free text (the cells mix numbers, dates and codes); only `purchase_status` is
normalized, and rollups count nothing else.

Milestones carry: assignee, department, planned/actual dates, status, delay category + reason,
vendor/PO/material-ready/QC flags, notes, a **dormant `depends_on_key`** for a future
dependency/critical-path layer, and **`reopened_at`** (§3b — set when a rework ticket reopens an
already-closed milestone, cleared implicitly whenever `actual_end` is next set on re-close; added
via the standing `addColumn()` migration helper in `lib/db.js`, not a one-off `ALTER TABLE`).

## 8. Operations-platform deferred items

Dependency graph / auto critical-path (`depends_on_key` column in place), an **activity feed UI**
(the underlying data now exists — `usb_audit`, §16 — just no page renders it yet), file/photo
uploads (the PMB blob in §5a is the only stored file — there is still no general document store),
barcode/QR validation at dispatch, email/WhatsApp notifications, and the §5a "deliberately not
built" list (drawings/IBR document management, BOM release workflow, Excel export, in-app BOM
authoring, supplier analytics). Installation and Design still just get their milestone list; QC now
has its own test-record module (§5b); Procurement/Stores/Production have the Master BOM.

**Tickets/notifications (§3b), next up:** notify-the-original-raiser when their rework/request
ticket is resolved, and overdue-ticket notifications — both named next, no new schema needed. After
that, distinct and later: BOM-received / QC-fail as new notification triggers, once BOM and QC get
refined. Also not fixed: re-notifying a downstream department if a reopened milestone gets redone
and re-closed (the `source_key` `UNIQUE` limitation, §3b).

**Also deferred:** a PM-oversight cross-department view for the Tasks calendar (§3a — PMs currently
have no Tasks tab at all, same as before); the multi-department "combined heads" dashboard for
Operations, deferred until a head actually running two-plus departments exists; an
**Operations-tab departmental-view redesign** (separate, not yet scoped); and reorganizing
Production's milestones around the department head's 7 named phases, or new dedicated Production
quality/inspection/testing milestones — parked until it's confirmed whether those are genuinely
distinct from QC's existing module, and whether the 7 phases are a real tagging layer over the
existing granular stages or just plain-English description.

---

# Part B — Approval / device-security platform

## 9. What it is

A separate but integrated system, reached via **Approvals** in the top nav (`/approvals`). It
blocks external devices and websites on an employee's Windows PC by default; the employee's
attempt to use them files a request; a **PM (manager/admin)** approves it with a **TOTP code**
(set up once in Settings) and it unlocks for a time-boxed window (default 15 min). Every
transition is audited. One approval engine, reused across every category below — adding a new
kind of thing to control is mostly configuration, not new code.

Two client pieces run on the employee's machine, both installed by **one installer**:

| Piece | Guards | Technology |
|---|---|---|
| **Windows Agent** (`agent/`) | USB storage, CD/DVD, phones (MTP/WPD) | Python, runs as a background service |
| **Browser Extension** (`extension/`) | Websites, per-domain | Chrome + Edge, Manifest V3 |

The Agent and Extension talk to each other over `127.0.0.1:47113` (localhost only) — the Extension
asks the Agent "is this domain allowed right now?"; the Agent is the only piece that talks to the
cloud dashboard.

**Approvals tab layout** (`app/approvals/page.js`, shadcn Tabs):
- **Devices** (live) — USB/CD/phone requests, whitelist, machine roster.
- **Browser** (live) — website policy, active grants, pending requests.
- **Mail** (placeholder) — see §16 and `docs/v4-zoho-mail-brainstorm.md`.

## 10. Devices — USB, CD/DVD, phones

**State machine** (agent-side, `agent/agent.py`): `BLOCKED` (default, fail-safe) → `PENDING`
(request filed) → `APPROVED` (unlocked until `expires_at`). Any rejection, revocation, expiry, or
device removal snaps back to `BLOCKED`. A **device-swap guard**: while one device is approved, any
*other* device appearing alongside it forces an immediate re-block — the registry-level block is
global, so an unapproved second device can't ride an open window.

**Enforcement is Windows registry policy, not service-disabling** (`agent/backends.py`,
`WindowsBackend`):
- **USB storage**: `USBSTOR` service `Start` value, 4 = blocked / 3 = allowed.
- **CD/DVD**: Removable Storage Access policy keys
  (`HKLM\...\RemovableStorageDevices\{53f56308-...}`) `Deny_Read`/`Deny_Write`, plus `NoCDBurning`
  belt-and-braces. *Not* the `cdrom` service — disabling that kills drive **detection** too, so a
  blocked disc could never be discovered and requested.
- **Phones (MTP/WPD)**: same Removable Storage Access mechanism, but **two** class GUIDs
  (`{6AC27878-...}` and `{F33FDC04-...}`, MTP vs PTP presentation) — both must be denied or some
  phones slip through.
- `block()` blocks **every** channel at once (fail-safe). `unblock(kind)` opens only the approved
  one.
- **Caveat, unconfirmed on real hardware:** Microsoft's own docs say the CD/phone deny may need a
  device or OS restart to take effect. The agent nudges with `pnputil /restart-device` as a
  best-effort mitigation. CI runners have no optical drive or phone, so this can only be confirmed
  on a real Windows machine.

**Device identity** (`lib/usb.js` `normalizeDevice`, boundary-validated): `usb`/`phone` carry real
4-hex-char VID/PID + serial from the descriptor. `cd` has none, so the **server** (not the agent)
assigns the fixed `0000:0000` identity and uses the disc's volume serial number instead.

**Whitelist**: a known-good device (e.g. the company's own USB drive) can be marked whitelisted
(requires TOTP to turn on) — this skips the approval step, not a permission gate; devices are
blocked by default regardless.

**Known gap**: there is no equivalent "always reject" / blocklist for a specific bad device by
serial number — every unknown device becomes a pending request that a PM must notice and reject
manually. The Browser side (§11) already has a real three-state policy (Allow/Block/Approval);
Devices only has two (default-block + optional whitelist-skip). Worth adding a
per-device `blocked` flag mirroring the browser model.

## 11. Browser — per-domain policy

**Policy model** (`approval_policies` table, `kind='browser'`, `target`=normalized domain,
`action` ∈ `allow | block | approval`) — set by a PM in the Blocked Websites section. Domains
match **exact-or-subdomain** (`lib/browser.js` `matchPolicy` server-side, `agent/browser.py`
`match_policy` Python-side — deliberately duplicated, each with its own self-check, since they run
in different runtimes). Most-specific target wins (a rule for `drive.google.com` overrides one for
`google.com`).

**Enforcement**: the Extension's background service worker polls the Agent's `/blocklist`
endpoint and mirrors the result into **declarativeNetRequest dynamic rules** — `||domain^` matches
the domain and every subdomain natively, so **no public-suffix-list logic is needed**. This was a
deliberate choice over `webNavigation.onBeforeNavigate`, which can't block synchronously under
Manifest V3. DNR rules **persist across browser/agent restarts** — if the agent goes down, the
last-known policy stays enforced (fail-safe, never fail-open).

A blocked/approval-pending navigation redirects to the extension's own `blocked.html`, which shows
the domain and, for approval-required domains, a "Request access" button. After a manager
approves, the block page messages the background worker to re-sync immediately (not wait for the
~30–60s periodic alarm) so the unblock lands in ~3 seconds.

**Agent-side** (`agent/browser.py`, `BrowserGuard`): a `ThreadingHTTPServer` on
`127.0.0.1:47113`, entirely separate from the device state machine. Caches the policy list and any
approved grants; local-clock expiry (an expired grant re-blocks on the *next* navigation, not
mid-page — same forward-looking model as devices, not a bug).
Trust ceiling (documented as `ponytail:` in the source): any local process on the machine can read
the policy list or file a request on this port. Acceptable because nothing is granted without
manager TOTP and the machine's cloud JWT never crosses this port. Native messaging (extension ↔
agent via Chrome's own IPC, not localhost) is the upgrade path if that ceiling ever matters.

**Force-install is the only real enforcement.** An unpacked/dev-mode extension can be toggled off
by the employee — it's test-grade only. Real enforcement needs the extension **published** (Chrome
Web Store) and force-installed via registry policy (`ExtensionInstallForcelist`, written by the
installer for both Chrome and Edge — they use separate registry paths, and Edge additionally needs
its "allow extensions from other stores" policy to force-install a Chrome-Web-Store item). See §14.

## 12. Auth boundary for the security platform

- **Dashboard routes** (`/api/usb/*`, `/api/browser/*`) — normal session cookie, `requirePM` /
  operator-scoped, same as the rest of the app.
- **Agent routes** (`/api/agent/*`) — Bearer JWT with `role: 'agent'` + a `machine_id` claim that
  can **only** come from the token (never the request body) — the trust boundary that stops one
  machine from acting as another. `middleware.js` bypasses the cookie check for `/api/agent/*`
  (agents never carry a cookie); the handler does real verification.
- `isAgent()` in `lib/auth.js` explicitly excludes the agent role from `isInternal()`, so a leaked
  agent token can never be pasted into a session cookie and pass as a human PM/operator login.
- **Enroll endpoint** (`/api/agent/enroll`) is the one deliberately **unauthenticated** route (a
  machine has no token yet) — see §13 for how it's still safe.

## 13. Enrollment — zero-typing setup

Registering a machine (`POST /api/usb/machines`, admin-only) creates the machine row **and** a
short single-use enroll code (`enroll_code`, 8-char Crockford base32, no ambiguous characters,
`enroll_expires` = now + 24h). Two ways to redeem it:

1. **Sidecar file (default, zero-typing)**: `GET /api/usb/machines/[id]/enroll-file` downloads a
   tiny `shanti-enroll.json` (`{server_url, enroll_code}`) for that specific machine. The admin
   drops this file — plus the installer — into the employee's Drive folder. The employee downloads
   both into the same folder and double-clicks the installer; it finds the sidecar file next to
   itself, and no dialogs ask for anything.
2. **Manual code entry** (fallback): the installer's wizard asks for the code directly if no
   sidecar is present.

Either way, the agent's first run does `POST /api/agent/enroll {code}` → the code is checked
(`enroll_code=? AND enroll_expires>now AND active=1`) → single-use (cleared on redemption) →
returns a long-lived machine JWT, which is what the agent actually uses from then on. The endpoint
is rate-limited per IP (in-memory token bucket, 10/minute) and every attempt (success or failure)
is audited.

**Leak risk, stated plainly**: whoever holds the sidecar file or the code can enroll one machine
as that employee within the 24h window. Bounded — a freshly enrolled machine can still do nothing
without a manager's TOTP on every subsequent approval, and the machine then shows up in the
Machines list for the PM to notice.

**Gap closed**: the "employee roster" view now exists — Approvals → **People** tab's Onboarding
Roster (§2a) shows every internal person, not just already-enrolled machines, with a derived
status (online / enrolled-offline / enroll-file-sent / no machine yet) and inline register + enroll-
file download.

## 14. Publishing & distribution

- **Windows Agent**: built by CI (`.github/workflows/agent-windows.yml`, `windows-latest` runner)
  via PyInstaller (`--onefile`) into `shanti-agent.exe`, then wrapped by an Inno Setup installer
  (`agent/installer.iss`) into `ShantiAgentSetup.exe`. The same workflow runs `--selftest` (state
  machine, no Windows needed) and `--winselftest` (real registry round-trips — USBSTOR, CD, both
  WPD GUIDs — genuinely only provable on Windows) against both the source and the built exe (catches
  PyInstaller bundling gaps), then does a silent-install smoke test.
- **Browser Extension**: zip `extension/` and upload to the Chrome Web Store Developer Dashboard
  (unlisted visibility is fine) — this is a manual, external step gated on Google's review (days).
  Once published, note the extension ID and set `#define ExtensionId "..."` in `installer.iss`,
  then tag a release — CI rebuilds the installer with the force-install registry keys now active.
  **Done** — published (`olhkhmeombmmgobcdmhojnngolecijcc`), wired into `installer.iss`, and built
  into the `v1.2.1` GitHub Release with force-install active. Still only verified on macOS via
  `--simulate` (agent) and unpacked-extension testing — the actual force-install / can't-be-disabled
  behavior needs a real Windows machine to confirm, never yet done.
- Full runbook: **[docs/SETUP.md](docs/SETUP.md)**.

## 15. Auto-update

- **Extension**: updates for free via the Chrome Web Store's own mechanism once published — no
  code needed.
- **Agent**: self-updates. Every poll, the agent's GET to `/api/agent/requests` returns
  `latest_version` and `update_url` (from the `AGENT_LATEST_VERSION` / `AGENT_UPDATE_URL` env
  vars). If the server's version is newer (`_is_newer`, tuple comparison) and an update URL is
  set, the agent downloads the installer, launches it detached
  (`/VERYSILENT /SUPPRESSMSGBOXES /NORESTART`), and exits so the installer can overwrite the
  running exe. The installer's `[Run]` step restarts the scheduled task automatically. Devices stay
  in their last-known blocked/allowed state during the few-second gap (registry state persists
  while the agent is down — fail-safe). The installer is update-safe: it never overwrites an
  existing real token with a blank one on re-run.
- **Shipping an update**: bump `__version__` in `agent/agent.py` and `MyAppVersion` in
  `installer.iss` → `git tag vX.Y.Z && git push --tags` → CI attaches the new installer to a
  GitHub Release → set `AGENT_LATEST_VERSION` on the server. Every enrolled machine updates itself
  within one poll cycle. No one ever needs physical/remote access to an employee's PC again.
- **No code signing** (decided, for now) — the installer is unsigned, so first run shows Windows'
  "protected your PC → More info → Run anyway" prompt once. Auto-update runs from the SYSTEM
  scheduled task, which mostly avoids SmartScreen. Revisit if a code-signing cert is purchased.

## 16. Approval-platform data model

```
machines (id, name, user_id → users, active, last_seen, agent_version,
          enroll_code, enroll_expires, enrolled_at)
usb_devices (id, vendor_id, product_id, serial, label, kind[usb|cd|phone],
             whitelisted, first_seen, UNIQUE(vendor_id, product_id, serial))
usb_requests (id, machine_id, device_id, status[pending|approved|rejected|revoked, 'expired' derived],
              reason, requested_at, decided_at, decided_by, expires_at)
usb_audit (id, request_id, machine_id, actor, action, detail, created_at)   -- generic, shared by devices AND browser

approval_policies (id, kind, target, action, UNIQUE(kind, target))          -- kind='browser' today; 'application' reserved for future app-control
browser_requests (id, machine_id, domain, status, reason, requested_at,
                   decided_at, decided_by, expires_at)                      -- deliberately a sibling of usb_requests, not a generalization — see below

users.totp_secret / totp_pending_secret / totp_fails / totp_lock_until / totp_last_code
```

**Design note for future contributors**: `usb_requests` and `browser_requests` are two separate
tables, not one generalized `approval_requests(kind, ...)` table. This was a deliberate choice —
the shared logic (`effectiveStatus`, `verifyTotp`, `audit`, lazy expiry) already lives in
`lib/usb.js` as functions that operate on any row shape with the right columns; generalizing the
*table* would have meant rewriting the already-shipped, already-tested device flow for zero
functional gain. `usb_audit` **is** shared/generic (action/detail free text) — reuse it for any
future approval category rather than creating a new audit table per kind.

**This table is now the system-wide audit trail, not just the security platform's.** It also logs
the operations-platform's core mutations — `milestone_edit` (project/key/changed-fields),
`access_matrix_edit` / `user_reactivated` / `user_deactivated`, `project_created`,
`packing_created` / `packing_status_change`, plus the BOM (`bom_import`/`bom_replace`/
`bom_item_edit`/`bom_item_delete`) and people (`user_registered`/`user_approved`/`user_rejected`)
actions from §2a/§5a. **No UI viewer exists yet** — it's queryable (`sqlite3`/Turso CLI) but not
surfaced in the app; add an Activity view once it's clear who needs to read it day-to-day (PM-only
global log? per-project history tab?).

## 17. Approval-platform deferred items

Native messaging (extension↔agent) instead of localhost · code signing · printing, clipboard,
screen-capture control · phones/desktop app-control to block side-installed browsers or messaging
apps · cloud-storage & web-messaging domains (these are just `approval_policies` rows once someone
asks — no new code) · Zoho external-mail approval (brainstorm doc exists, not built — see
`docs/v4-zoho-mail-brainstorm.md`) · the device-blocklist gap in §10 (employee-roster gap in §13 is
now closed — see §2a). TOTP is not required for people approvals (v1) — session + the approval
hierarchy + audit trail was judged sufficient; revisit if that proves too light.

---

# Part C — Shared architecture & running the app

## 18. Tech stack

- **Next.js 14** (App Router) + **React 18**. Server components read data directly; API routes
  handle writes, auth, and PDF generation. PDFs via `@react-pdf/renderer` (pure Node, externalized
  in `next.config.js`).
- **UI: Tailwind CSS v4 + shadcn/ui** (radix primitives in `components/ui/`). Theme tokens (premium
  palette + status colors) live in `app/globals.css`; dark mode via the `[data-theme="dark"]` toggle
  in `components/Nav.jsx`. Toasts via `sonner` (`showToast` in `lib/client.js` wraps it).
  **Gotcha, already hit once:** `CardHeader`'s base class is `display: grid`; a `className="flex-row
  items-center justify-between"` override has zero effect (grid ignores flex properties), so a
  trailing action silently stacks under the title instead of sitting beside it. Use `CardAction`
  (already exported from `components/ui/card.jsx`, triggers a `grid-cols-[1fr_auto]` rule) for any
  title-row action — don't reach for the flex override again.
- **Responsive layout:** the content column is defined once — an unlayered `.container` rule in
  `app/globals.css` (centered, `max-width: 1760px`, fluid `clamp` padding) — so it's balanced on a
  1920 monitor (symmetric gutters) and comfortable on mobile. **Mobile is app-like:** desktop
  top-tabs collapse into a fixed **bottom tab bar** (icons) below `md`; tables like Projects render
  as cards on mobile, a table on desktop.
- **Database: Turso (libsql)** via `.env.local`; falls back to a local SQLite file for offline dev.
  Schema = raw `CREATE TABLE IF NOT EXISTS` DDL in `lib/db.js` `migrate()`, additive changes via
  `addColumn()` (ignores "duplicate column" on re-run).
- **Auth**: bcrypt + JWT in an httpOnly cookie carrying role + granted departments (human users) or
  a Bearer header carrying `role:'agent'` + `machine_id` (the Windows agent). See §12.
- **Windows Agent**: Python 3, stdlib-only HTTP server (no new dependency), `requests` +
  `pywin32`/`wmi` on Windows. PyInstaller for the executable, Inno Setup for the installer.
- **Browser Extension**: vanilla JS, Manifest V3, declarativeNetRequest — no build step, no
  framework.

## 19. Repo layout

`lib/` — db, auth, sla/delay engine, milestone taxonomy, data helpers, formatters, packing-pdf,
`pmb.mjs` (PMB Excel parser + its `pmb-selfcheck.mjs`), `bom-fields.mjs` (BOM field ownership —
pure data, importable client-side), `usb.js` (device approval domain logic, shared primitives),
`browser.js` (domain normalize/match), `enroll.js` (enrollment codes + rate limit), `date.js`
(IST-pinned `todayISO`/`todayMonth`/`monthGridBounds` — see the IST gotcha in §18), `handoff.mjs` +
`handoff.test.mjs` (§3b, the pure handoff rule + its `node --test`), `tickets.js` (§3b, ticket
creation + notification fan-out), `beep.js` (§3b, WebAudio chime, no audio file).
`app/` — pages + API routes, including `api/agent/*` (Bearer-agent), `api/usb/*`, `api/browser/*`
(session-cookie, PM-gated), `api/qc-records/*` (§5b, QC + PM-gated), and `api/tickets/*` +
`api/notifications` (§3b). `app/login/page.js` / `app/d-login/page.js` (§2c) are the production
sign-in page and the gated demo picker; `app/production/*` (§3a, Tasks + Workers — route name is
legacy, Tasks now works for every department) is gated by `isHead`/`headDepartments` (any
department) except Workers, which stays `inDepartment(user, 'Production')`. There is no
`app/tickets/*` anymore — tickets live inside `app/page.js` (Operations) and the Tasks calendar
(§3a/§3b); `app/notifications/page.js` is the bell's "View all" destination, not in nav.
`app/layout.js` is also where the device-setup gate lives (see §2a) — every page renders through it.
`components/` — nav, project/milestone/packing UI, settings forms, `DevicesPanel` /
`BrowserPanel` / `PeoplePanel` / `TotpSetup` for the Approvals tab, `QcPanel.jsx` (§5b),
`DeviceSetupGate.jsx` (§2a), `InfoPopover.jsx` (§2b, contextual help), `help-content.jsx` (the
role-aware `/help` guide content — plain data, no CMS, also feeds `InfoPopover`),
`ProductionToday.jsx` / `WorkersPanel.jsx` (§3a), `NotificationBell.jsx` / `TicketsPanel.jsx` (§3b).
`components/ui/` — shadcn primitives, including `popover.jsx` (added this round, same
`radix-ui` unified-import pattern as the rest).
`agent/` — the Python Windows agent, its Inno Setup installer, and its own
[README](agent/README.md) (build/test commands, deeper technical detail than this file).
`extension/` — the Chrome/Edge MV3 browser-policy extension. Published — see §14.
`docs/` — [SETUP.md](docs/SETUP.md) (go-live checklist/runbook),
[v4-zoho-mail-brainstorm.md](docs/v4-zoho-mail-brainstorm.md) (future milestone framing),
[extension-onboarding-status.md](docs/extension-onboarding-status.md) (plain-language Windows
onboarding steps, generic enough to hand to a PM), `Device-Agent-Install-Guide.docx` (non-technical
employee install guide).
`public/fee.html` — a **standalone, self-contained client pricing proposal**, unrelated to the app
itself. Deliberately not linked from anywhere in the UI — reached only by typing the URL directly.
Has its own embedded fonts/styling and doesn't share the app's design system. Don't delete it as
"unused"; it's live business material.

## 20. Run

```bash
npm install
npm run dev        # http://localhost:3000
```

Demo project **SB-1018** seeds on first run as a single flat 25-stage milestone chain (completed →
an overdue/blocked vendor bottleneck → in progress → upcoming) plus the `PL-1001` packing list, and
the demo logins in §2.

For the security platform on macOS (no Windows machine needed for development):
```bash
python3 agent/agent.py --selftest      # state-machine assertions, no server needed
python3 agent/agent.py --simulate      # exercises the real backend API; edit agent/sim_events.txt
                                        # to fake device insertions, e.g. "0781 5567 SN1 SanDisk"
```
Real Windows-only behavior (registry effects, WPD/CD blocking) can only be verified in CI
(`--winselftest` on the `windows-latest` runner) or on a physical Windows machine.

> Note: don't run `npm run build` (production) against the same working tree while `npm run dev`
> is pointed at it — mixing build output and dev-server output in one `.next` folder corrupts it
> (missing vendor chunks, pages render unstyled). If that happens: stop the dev server,
> `rm -rf .next`, restart.

## 21. If you're an AI picking this project up cold

Read this file, then in this order if you need more: `agent/README.md` for agent build/test
commands, `docs/SETUP.md` for the deployment runbook, then the actual source — `lib/usb.js` and
`lib/browser.js` are the two files that encode almost all of the approval-platform's business
logic and are worth reading in full before touching anything in `app/api/agent/*` or
`app/api/usb/*`/`app/api/browser/*`. Known gaps are listed explicitly in §10, §13, and §17 — don't
rediscover them, just check whether they've since been closed (git log / the API surface) before
assuming they're still open.
