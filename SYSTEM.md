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

**Product decision, superseded — do not act on this paragraph, see §5q:** `V3_CHANGES.md` §12
originally deferred regulated accounting/GST/TDS/statutory payroll as ERPNext-integration
territory. That decision was reversed 2026-08-20 (§5q): Shanti Ops is now the system of record for
the full Accounts workflow (ledger, GST, TDS, fixed assets, payroll export, Dispatch freight/e-way
capture), built out through §5z and §5aj — not a stub, not an ERPNext dependency. Left here only so
a reader who finds the old `V3_CHANGES.md` §12 text elsewhere knows it's stale. CRM, Selling, and HR
(incl. Recruitment) are still built natively to real ERPNext feature depth, unaffected by this
reversal.

Everything in this file reflects the **current, working build**, updated as work lands — most
recently 2026-08-23 (§5aj, Dispatch's first accounting integration — freight cost, real invoice
linkage, e-way bill capture, a new Report Engine entry; §5ai, an RCM real-transaction test that
found and fixed two real ledger-posting bugs; §5ah, the statutory-rate sync's daily Cloudflare Cron
Trigger going live).
The paragraph below is itself a dated snapshot from 2026-08-03, describing what was the most recent
round **at that time**: a **full Procurement redesign** — the working spec lived in
`PROCUREMENT-CHANGES.md` during the
build and is now folded in here (§5c); that file stays as the historical record of the investigation
and decisions, marked done. Five phases, each verified live and committed separately: (1) a clean
demo dataset replaced 780 rows of imported PMB Excel that had zero suppliers/quotes ever logged
against it — unreadable as a demo, and unable to show the sourcing lifecycle's `comparing`/`on_order`
stages at all; (2) a new **Requests tab** with an acceptance gate — a new-item request from
Engineering/Design isn't a `bom_items` row, and doesn't show up anywhere in Procurement, until
Procurement accepts it there; cancel requests were folded into the same inbox; (3) the `/procurement`
workspace rebuilt from a single segmented list into four tabs — **Sourcing** (gather quotes, inline
per item) → **Selection** (compare, pick a supplier, which now auto-drafts a PO) → **Purchase
Orders** (View/Issue/Cancel Issue — issuing now also flips items to `TRANSIT`, not just stamping
`po_ref`) → **State** (search + a manual status override that's always available, whatever stage an
item is nominally in); (4) Operations' Procurement view replaced its old KPI tiles with a pipeline
flow diagram (`Requests → Sourcing → Selection → PO issued → Closed`, plus a separate Cancelled
tile), and dropped the now-fully-redundant "Waiting on" card (checked live first: only one milestone
across the *entire app* has ever had a `delay_category` set); (5) the project page reordered — the
Milestone Tracker now leads, and "Needs Attention" is `Open Actions` everywhere it appears (both
Operations and the project page), split into **Urgent** (not yet delayed, closest deadline first)
and **Needs attention** (already overdue/blocked) — and, Procurement-specifically, the plain BOM
table and Tickets/Raise card are gone from its project-page section now that BOM work lives entirely
in `/procurement` and requests arrive via the Requests tab (every other department's project page is
unchanged). Deeper history (the tickets-collapse round, the Tasks/Workers split, the login-page
split, QC test records, multi-project customer logins, etc.) lives in `git log` now rather than
repeated here — each is still documented in full in its own numbered section below, just not
re-summarized at the top on every round.

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
| `admin` | `admin123` | **PM** (`admin`) | Everything — all projects, all departments. Owns project creation. |
| `manager` | `manager123` | **PM** (`manager`) | Same as admin for the ops platform; both are "PM" — see `isPM()` in `lib/auth.js`. Cannot register agent machines (admin/executive only, `app/api/usb/machines/route.js`). |
| `executive` | `executive123` | **PM** (`executive`) | Same full surface as admin/manager, plus top of the approval hierarchy — approves Project Manager registrations that a `manager` cannot (see §2a). Also, with `admin`, one of the two roles that can register agent machines. |
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
Nav) opens **`/help`**. Customer help remains in `components/help-content.jsx` as
`CUSTOMER_GUIDE`. Internal department help is now driven by
`components/department-help-content.jsx` and rendered by
`components/DepartmentHelpWorkspace.jsx`; each guide has an introduction, an icon-labelled feature
list, and a final **How To** section. A PM can preview every department guide, while a functional
head sees only their **granted** departments. Sales and Marketing have separate content, so
Marketing never inherits a Sales heading or explanation. Adding a feature is one data entry in the
department guide, not a new route or page.

### Help workspace update (2026-08-15)

- All internal departments now use the same sidebar order: department selector when a user has
  multiple departments, Introduction, Features in sequence, and How To last.
- Guides currently cover Design, Engineering, Procurement, Stores, Production, QC, Dispatch,
  Installation, Sales, Marketing, and HR, with plain-language explanations and practical steps.
- The shared workspace resets to Introduction when the user switches departments, and the content
  is rendered client-side without another login or page navigation.
- The original Home/Tasks calendar UI from `app/production/page.js` is now rendered at `/`; the
  legacy `/production` route remains available. The original Operations dashboard implementation
  remains in `app/page.js` as `OperationsPage` and is rendered at `/ops` through
  `app/ops/page.js`. No dashboard UI is replaced by a simplified landing page.
- Each feature page now includes its existing explanation plus a practical checklist and a visible
  Watch out section. Each department Introduction welcomes the user, explains the Home → Operations
  → Projects → department framework, and shows icon-led feature summaries that open the detailed
  feature guide. The detailed feature framework is consistent across all 40+ feature entries:
  **Why this matters**, **How it works in Shanti Ops**, **Work through it**, **Avoid this**, and
  **Done when**. The first and last sections explain the business value and the handoff outcome,
  while the middle sections explain the real workflow and the control points built into the app.
- The How To page uses the same learning pattern for every department: a responsive step map, large
  two-digit step numbers, an action description, why the step matters, and a verification check
  before continuing. The five-step sequences remain grounded in each department’s real project,
  record, handoff, and close-out workflow.
- The older CRM-specific help components remain in the repository for compatibility, but
  `/help` uses the shared department workspace as its source of truth.

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

### Shared navigation and landing model (2026-08-15)

All internal users now land on **`/` — Home** after login. The existing designed Home dashboard is
preserved intact; `/ops` is an explicit URL alias to that same dashboard so routing did not create a
second simplified Home design. `/projects` remains the common Projects workspace. Customers
continue to land on `/portal`.

The primary navigation is now stable across roles:

- `Home` → `/`
- `Operations` → `/ops`
- `Projects` → `/projects`
- PM/admin tabs → `/executive`, `/approvals`, plus all department workspaces available to PMs
- Functional-head tabs are derived from `users.departments` at render time: Tasks/Workers,
  Procurement, Inventory, Sales, Pipeline, Reports, HR, Calc Sheets, Certificates, Dispatch, and
  Requests as applicable. Shared workspaces such as Sales/Marketing and Design/Engineering appear
  once rather than once per department.

The existing `/production` route remains the calendar/tasks route for compatibility; it is no longer
the Home tab. `/packing` remains a compatibility entry point and redirects to `/ops?dept=Dispatch`.
Adding or removing department access through the admin Settings → User Management flow changes the
next fresh navigation render automatically. API and server-page authorization use the fresh database
user lookup, so the new tabs and their access rules stay aligned.

### Workspace sub-navigation update (2026-08-15)

The cog's **Departments** menu is now shown to PM/admin/manager users and to heads with more than
one granted department. A single-department head already has that department in the primary
navigation, so the redundant one-item menu is hidden.

Navigation-style sub-tabs now use the shared `components/WorkspaceSidebar.jsx` shell with the same
collapsible sidebar, icon buttons, active state, mobile trigger, and inset content treatment as the
Help workspace. Converted workspaces are Procurement (Enquiry, Selection, Purchase Orders, Status,
  Suppliers), Approvals (Devices, Browser, People, Mail), HR, Payroll, Expenses, Workers, project
  department panels, Calc (Worksheet, Analysis), and milestone Stages (Kanban, Manage). Nested
  workspaces such as Payroll and Expenses use the compact responsive version of the same sidebar
  language so HR does not render competing full-width sidebars.

The sidebar shell keeps the workspace name in the desktop sidebar and uses the active section name
in the mobile context header. Full workspace pages no longer wrap the shell in a duplicate PageHeader;
this prevents the fixed collapsed rail from overlaying a second title and removes the artificial
vertical offset above the work area. Workspace content uses a consistent four-unit vertical gap so
toolbars/search controls remain visibly separated from their result cards. These rules live in
`components/WorkspaceSidebar.jsx`, so converted workspaces inherit the same correction. In the
collapsed state, the workspace icon uses the same centered 32px grid as navigation icons, and a
visible expand control sits directly below it above the navigation list; the rail is no longer the
only discoverable way to reopen the sidebar. The Calc Worksheet/Analysis switch is owned by
`CalcWorkspace` and is passed explicitly into its `ProjectPanel` child; this keeps the view state
in the existing calculation shell while avoiding an undefined reference in the extracted panel.
The Calc project/sheet breadcrumb also keeps its sheet switcher flex-constrained inside the sidebar;
long sheet names truncate with an ellipsis instead of expanding the sidebar into the content area.
The same collapsed-state alignment and visible expand control are also applied to the custom Calc,
Sales/Marketing, CRM Reports, and Help sidebar shells; all `SidebarProvider`-based sidebars now
share the same collapsed interaction instead of relying on the hidden rail alone.
Calc's nested Worksheet/Analysis switch intentionally omits its redundant "Calculation view" label;
the parent Calc sidebar and content header already establish that context. Its primary Calculation
entry uses the calculator icon, Analysis uses a chart icon, Portfolio uses a dashboard icon, and
Drawings uses a pencil/ruler icon; Registry, Methodology, Library, Tables, and Audit retain icons
matching their data or workflow purpose.

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

1. **Row 1 — Milestone Tracker:** the same component as the Executive dashboard
   (`components/PortfolioDelayTimeline.jsx`), scoped to this one project — its stages as a
   connected, color-coded bar with a today-marker, expandable into a per-stage pill chain (status,
   delay delta, actual dates), cumulative dispatch delay at the end. Leads the page (moved above the
   identity row in the Procurement redesign, §5c) since it's the one thing every role wants first.
2. **Row 2 — identity + Open Actions + Master BOM (three columns):** project header (name, status,
   "why is this delayed?" blocker callout, PM/value/updated, Customer-view link), **Open Actions**
   (`components/TodayBand.jsx` — renamed from "Needs Attention"; only the milestones that matter
   right now, scoped to the viewer's department if they're a head, split into **Urgent** — not yet
   delayed, closest deadline first — and **Needs attention** — already overdue/blocked, below), and
   the **Master BOM** rollup (`BomProgress`, moved into this row from its own full-width one below
   the tracker).
3. **Row 3 — department work**, which differs by role:
   - **PM/admin** see an **all-departments tab strip** (underline style,
     `components/ProjectDepartmentTabs.jsx`) — one tab per department, with a red dot on any
     department that has an overdue/blocked milestone.
   - **Functional head** sees their own department(s) as stacked sections (no tabs) — each is a
     `components/DepartmentPanel.jsx`.
   - Each department's panel (`DepartmentPanel`) shows: that department's milestones via
     `MilestoneBoard`/`MilestoneCard` → edit drawer (`MilestoneDrawer`), plus a department-specific
     panel where relevant — **Engineering → Bill of Materials** (`BomPanel`), **Dispatch →
     Packing** (`PackingPanel`, this project's packing lists + generate-from-BOM). Every department
     also gets the plain Master BOM table (Stores/Production, column-scoped per §5a) and a
     Tickets/Raise card — **except Procurement**, whose project-page panel is deliberately just
     milestones + `ProcurementQueue` + Stages: its BOM work lives entirely in `/procurement` now and
     requests arrive via the Requests tab, not this page's Raise dialog (§5c).
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

**Verified across every department**, across two sessions: Design, Engineering, Production, then
Procurement, Stores, QC, Dispatch, Installation — Tasks tab loads, Month/Week/Year all render, the
To dos rail is correct, task creation is scoped to the right department, and Workers never appears
outside Production.

**Two bugs found and fixed while verifying** (both in `ProductionToday.jsx`'s task composer, both
about department resolution going stale across a client-side nav):
1. The composer resolved a new task's department from `newTask.department` state, seeded once from
   `deptsToShow[0]` on mount. A multi-department head switching tabs (e.g. Procurement → Stores)
   does a client-side nav that reuses the same mounted component, so that state stayed at whichever
   department loaded first — and with one department shown the picker itself is hidden, so there
   was no way to see or correct it. A task created from the Stores tab was silently saved under
   Procurement. Fixed by resolving `combined ? newTask.department : deptsToShow[0]` at submit time
   instead of trusting the stale state when the picker isn't rendered.
2. (Found later, during the tickets→tasks collapse below) The cross-department raise endpoint
   initially derived "is this your own board" from department-membership overlap
   (`headDepartments(user).includes(department)`), which breaks the moment one person holds two
   departments (a real case here — a head can be granted several) or is a PM (who holds none, by
   construction). Fixed by using the presence of `from_department` in the request body as the
   caller-intent signal instead of re-deriving it — see §3b.

**Navigation update (2026-08-15):** the existing `/production` Tasks calendar is now also rendered
at the common **Home** URL `/`, and the original Operations dashboard is rendered at `/ops`.
Navigation is derived from the user's current `users.departments` grants, so liaison roles appear
with every newly granted workspace on the next render. Shared department workspaces are deduplicated.

- **Home / Tasks** (`/` with `/production` retained as a compatibility route,
  `components/ProductionToday.jsx`) — Month/Week/Year calendar merging **two** sources per day:
  **milestones** (`planned_end`) and **tasks** (`title, due_date, status, department, assigned_to,
  from_department, project_id` — the last two added when tickets collapsed into this table, §3b).
  `getDepartmentCalendar(departments, from, to)` in `lib/data.js` takes an array so a
  multi-department head sees a **combined view by default**, narrowed to one via the same `?dept=`
  nav-tab idiom Operations already uses (`deptFilter`/`deptsToShow` in `app/production/page.js`,
  mirroring `app/page.js`). Combined-view pills prefix with `[Department]`. A **"Tasks" rail**
  (renamed from "To dos") lists open tasks regardless of which day is selected — this now includes
  cross-department-raised tasks for free, since those are just `tasks` rows with `department` set
  to the target. PMs see the combined department calendar at Home, while heads see only their
  granted departments; the same `?dept=` filter narrows either view.
- **Workers** (`/production/workers`, `components/WorkersPanel.jsx`, Production-only) — a **Home**
  sub-tab (headcount + today's attendance %, derived from props already on the page — no new query)
  alongside the daily attendance + work-assignment sheet for shop-floor workers who **never log in
  and have no `users` row** (`workers` table: name, trade, department, never deleted, only
  deactivated). One row per worker per day (`worker_days`, `UNIQUE(worker_id, date)`) —
  present/half/absent, optionally linked to a project + milestone they worked on.
- **Landing tab:** `roleHome`/`postLoginHome` (`lib/auth.js`) send every internal role to `/`;
  customers still go to `/portal`. Unauthorized compatibility redirects also use this common Home.
- **Invalid-session fallback:** if middleware sees a stale cookie but the fresh database lookup no
  longer finds an active user, `roleHome(null)` resolves to `/login`; Home and Operations explicitly
  enforce the same guard before doing any dashboard work.

### Production roster unification + Job Card supersedes Workers (2026-08-16)

The `workers`/`worker_days` tables described above are **retired** (migrated then dropped, not kept
frozen — a from-scratch DB never creates them at all now). PRODUCTION-MODULE-DESIGN.md §2.5's
finding: `workers` and HR's `employees` had drifted into two rosters for the same people, because
`seedV3HrData`'s copy only ever ran once. Fixed for good, not just re-synced: a shop-floor worker is
now an `employees` row (`department='Production'`, `employee_type='worker'`) — one people master,
no second table. HR owns identity/designation/payroll; Production owns trade/availability/job-card
history. Attendance moved the same way, onto HR's `attendance_days` (already built, employee-keyed)
— Production's Daily Sheet and HR's own attendance screens now read/write the same rows, not two
systems kept in sync by hand.

- **Add-worker is search-first.** `GET /api/production/workers?search=` checks HR before creating
  anyone — a `worker`-type match gets activated onto the roster in one click; a `staff`-type match
  is shown but not selectable (reassigning staff into Production is an HR decision); only when
  nothing matches does the form fall through to create a new person, and even then the server
  rejects an exact-name duplicate against the existing Production roster. This is what stops the
  drift from recurring inside the unified table.
- **Trade is a controlled list** (`trades` master — Welder, Fitter, Gas Cutter, Machinist, Grinder,
  Painter, Rigger, Helper), not free text, and is a different axis from HR's `designations`:
  trade/skill is what a job card assigns work by; designation is a pay grade/title. Never duplicated
  into Production.
- **Nav: `Workers` tab renamed `Job Card`**, the board (§5g) is now the default landing view;
  `Daily Sheet` (Overview + Sheet merged into one nested sub-sidebar, `WorkspaceSidebar`'s `nested`
  mode — same pattern Payroll uses inside HR) and `Workers Roster` are sub-tabs beneath it, alongside
  a new `BOM` tab (§5g). The `Tasks` nav item is dropped — it was identical to `Home` for a
  Production head, a leftover from before the 2026-08-15 nav redesign moved that content to `Home`
  for everyone.

## 3b. Cross-department signals — tickets collapsed into milestones + tasks + notifications

Closing a milestone used to leave the *next* department with no signal it was their turn, and
Engineering/Stores (who own zero milestones — they work through the BOM) had no place in the
handoff chain at all. Two earlier rounds fixed that with a standalone `tickets` entity — first the
signal, then (resolving a ticket touching the milestone it was about) the loop. This round removed
the entity itself: a `tickets` table sitting alongside `milestones` and `tasks` was a third workflow
concept doing work the other two could do directly. The rule now:

> Every cross-department event fires a **notification** (the signal). The **work object** carries
> the state: the **milestone** where one exists, otherwise a **task**.

Milestones stay the single workflow backbone — this didn't add a second stage hierarchy, it removed
a layer that sat on top of the existing one. Only 6 of 8 departments own milestones (Production 59
rows, Procurement 25, Design 20, Installation 10, Dispatch 6, QC 5 in the seed data; **Engineering
and Stores own zero**, per §3a), which is why rework aimed at those two still needs a task, not a
milestone reopen — there's nothing to reopen.

- **Automatic handoff** (`lib/notify.js` `fireHandoff`, formerly `lib/tickets.js`): closing the
  *last* milestone in a department's run (`lib/handoff.mjs` `handoffTarget`, reading each project's
  own `milestones` rows ordered by `sort_order` — not the static template, since a PM can reassign
  `department` per row, unchanged from before) fires a **notification only** — no row is created.
  Idempotency moved from a `tickets.source_key` UNIQUE constraint onto the notification's own
  `dedupe_key` (`'handoff:<closed milestone id>:<reopen_count>'`, `UNIQUE(user_id, dedupe_key)`) —
  keying on `reopen_count` is what **fixes the old known limitation**: redoing the work and
  re-closing a reopened milestone now fires a *new* dedupe key, so downstream gets notified again.
  Confirmed live: closing, reopening, and re-closing the same milestone produced two independent
  sets of handoff notifications (`handoff:<id>:0` then `handoff:<id>:1`).
- **Sending a milestone back for rework** (`POST /api/milestones/[id]/reopen`) is now a single
  direct action instead of "raise a ticket, then resolving it reopens the milestone as a side
  effect": `isInternal(user)` only, **not** gated to the milestone's own department (the *other*
  department is who calls this) — same permissiveness `POST /api/tickets` used to have. Requires a
  `reason`; 404s if the milestone isn't actually closed yet (`actual_end IS NOT NULL OR
  status='done'`). Clears `actual_end`, sets `status='in_progress'`, stamps `reopened_at` (already
  existed, drives the "(Reopened)" label via `lib/sla.js` `effectiveStatus`) plus new
  `reopen_reason`/`reopened_by`/`reopen_count` columns, logs `usb_audit` action
  `milestone_reopened`, and notifies both the milestone's own department (the reason) and — if it
  had already handed off downstream — that department too, via the same `handoffTarget` chain
  lookup `fireHandoff` uses (not a stored department column; notifications don't carry one).
  Verified live: `procurement_head`, who has **no access to Design's own milestone drawer**,
  successfully reopened a Design milestone via the cross-department panel below — the actual
  point of keeping that panel's reach broad rather than department-gated.
- **Rework or a plain request aimed at a department that owns no milestone** (Engineering, Stores)
  — or any other cross-department ask not tied to a specific milestone — is a **task**:
  `POST /api/production/tasks`, which now does double duty as both the department's own Tasks-tab
  composer (self-board, no signal) and the old ticket-raise endpoint (cross-department, fires a
  notification). The two callers are told apart by whether the body carries `from_department` at
  all — **not** by re-deriving "is this your own department" from `headDepartments` overlap, which
  breaks the moment one person holds two departments or is a PM holding none (see the bug note in
  §3a). When `from_department` is present it's validated via `canAccessDepartment` (true for a PM on
  any department, true for a head only on their own granted ones — the exact rule `POST /api/tickets`
  used); when absent, the caller must be an actual head of the target department. `tasks` gained
  `from_department`/`project_id` columns to carry this.
- **Notifications** fan out one row per recipient (`notifications` table) to everyone in the target
  department (`lib/notify.js` `notifyDepartment`, matched via `parseDepartments` — PMs are excluded
  by construction since their `departments` column is NULL). The acting user is excluded from their
  own notification (`except`). A notification now points at `milestone_id` or `task_id` (both new
  columns) instead of `ticket_id` — `getNotifications` (`lib/data.js`) resolves the bell's link
  target via `COALESCE(m.project_id, tk.project_id)`, same flat output shape as before, so
  `NotificationBell.jsx`/`NotificationsPanel.jsx` needed zero changes. Still **not** built: notifying
  the original raiser when their own raised task is marked done, and overdue-task notifications —
  both explicitly next, not part of this round (see §8).
- **The bell** (`components/NotificationBell.jsx`, mounted in `Nav.jsx`) polls
  `GET /api/notifications` every 20s with a plain `fetch` — deliberately not `router.refresh()`,
  since Nav is mounted on every page and that would re-fetch every page's server data on a timer.
  Chimes (`lib/beep.js`, WebAudio, no audio file committed) only when the unread count increases,
  never on first load; the mute toggle persists to `localStorage.notifySound`.
- **Two surfaces now**, not three: a **cross-department card inside each department's project panel**
  (`components/TicketsPanel.jsx` — kept its old name and most of its shape deliberately, a much
  smaller diff than a rebuild; it lists that department's tasks in both directions — raised for it,
  raised by it — and its "Raise" composer offers Reopen (project context only, closed milestones in
  the target department) or Task) and the **same card, department-scoped, on Operations**
  (`app/page.js`, same `deptFilter`/`deptsToShow` pattern as the rest of that page). Reopened
  milestones don't get a duplicate row in this card — they already show "(Reopened)" inline on the
  tracker. A full **`/notifications` page** (not in nav, reachable only from the bell) lists the
  fuller history generically off `kind`/`title`/`body` — no per-kind branching, unchanged.
- **The `tickets` table itself is not dropped** — `notifications.ticket_id` has an FK to it and the
  handful of pre-collapse rows are real history (some deliberately seeded as test fixtures in
  earlier rounds). Nothing reads or writes it anymore; a `ponytail:` comment in `lib/db.js` marks it
  safe to `DROP TABLE` once nobody needs that history to make sense of old `usb_audit`
  `ticket_status_change` entries.
- **BOM-received / QC-fail notification triggers — built (2026-08-21).** No longer deferred.
  `app/api/bom-items/[id]/route.js`: on the transition of any BOM line into `Received`, QC is
  notified once per project on first receipt ("materials arriving, incoming inspection can start")
  and Production+QC are both notified once when the project's BOM is fully
  `Received`/`Cancelled`/`In-Stock` ("cleared to start production & inspection") — same
  transition-guard idiom as the pre-existing Stores `bom_received` notification right above it in
  the same route. `app/api/qc-records/[id]/route.js`: a record's `result` flipping to `fail`
  notifies Procurement (if `bom_item_id` is set — a rejected incoming material, replace it) or
  Production (any other failure — rework), one-shot per record via the usual `dedupe_key`. Both
  live-verified end to end on a real project (SB-1023 repositioned as the showcase — see the
  10-project demo lineup note in `4.5-DATA-INVENTORY.md`'s 2026-08-21 entry).
- **Deliberately deferred, not built yet:** notify-the-raiser-on-resolution and overdue-task
  notifications (next, see §8); a mobile bottom-bar fix for heads with several department tabs;
  **Workflow Stages** — a reusable, department-defined checklist layer *under* a milestone (Open →
  Current → Closed swimlanes, auto-completing the milestone when all stages close) — discussed and
  scoped as a distinct follow-on, not started; see the plan notes from this session if picking it up.

## 3c. Workflow Stages — a reusable checklist layer under a milestone

Milestones stay the single workflow backbone (§3b) — Stages doesn't add a second hierarchy, it adds
a finer-grained, optional layer *under* one milestone for departments whose real work inside a
milestone has its own sub-steps. Lives on the project page, inside each department's
`DepartmentPanel` (`components/StagesPanel.jsx`), next to that department's existing milestone list
for **this one project** — deliberately not on the department-filtered Operations page.

- **Two tabs, Kanban default.** **Kanban** pools every stage across **every milestone this
  department owns on this project** into one Open/Current/Closed board — e.g. a Design head with
  ~4 milestones on a project sees all of their stages together, each card labeled with which
  milestone it belongs to. Drag-and-drop is native HTML5 DnD (`draggable` + `dragstart`/`dragover`/
  `drop`) — no library added, none existed in the repo and none was needed. **Manage** picks one of
  the department's own milestones on this project, shapes that milestone's own stage list, and
  separately manages the reusable, **named** templates for that milestone type (see below) — editing
  a template never touches any project's own instance list, and vice versa, except through an
  explicit Save/Apply action.
- **Named, multi-template model — a department can save several templates per (department,
  milestone_key)** (e.g. "Standard" vs "Fast-track" for Design's `design` milestone), exactly one
  marked **default**. `stage_templates` is the header row (department, milestone_key, name,
  is_default); `stage_template_items` is its ordered stage list. The normal way a template is born:
  shape a milestone's own stages first (add/remove/rename in "This milestone's stages"), then **Save
  as template** — names it and copies the current list in one shot (`POST /api/stage-templates`).
  From there the template is edited independently — rename it, **Set default**, rename/reorder
  (↑/↓)/remove its items, or delete the whole template — via `PATCH`/`DELETE
  /api/stage-templates/[id]` and `.../items/[itemId]`.
- **The default auto-copies at project creation — this directly answers "when does a project get
  its stages, and by which department": `createProjectMilestones` (`lib/db.js`), the single choke
  point both `POST /api/projects` (a PM creating a real project) and the demo seed already call for
  every one of the 8 departments' milestones at once, now also copies whichever `stage_templates` row
  is `is_default` for each `(department, milestone_key)` it inserts — one lookup per milestone,
  silently a no-op for a type with no default yet.** Verified live: after saving Design's "Standard
  Design" template as the default, creating a brand-new project (`POST /api/projects`) produced a
  Design milestone whose stages were already present, in the template's order, with zero manual
  steps. A milestone that predates its type's template (or whose head wants a non-default template)
  still gets **Apply template** in Manage — a dropdown of that type's templates, applied on demand,
  guarded to milestones with zero stages so applying never merges into or clobbers an existing list.
- **Auto-complete.** `PATCH /api/milestones/[id]/stages/[stageId]` (status change, e.g. from a
  Kanban drop) checks after every update whether every stage under that milestone is now Closed; if
  so it stamps the milestone `status='done'` (+ `actual_start`/`actual_end` via `COALESCE`, same
  auto-stamp precedent as the milestones route) and calls the **existing** `fireHandoff` — the same
  handoff a manual Close fires, so downstream still gets notified. Guarded by the same `wasDone`
  check the milestones PATCH route uses, so it never re-fires on a milestone that was already done.
  Verified live: closing every stage under Design's last milestone (`release_drawings`) on SB-1018
  auto-completed it and notified `procurement_head` with the same "Handoff from Design" notification
  a manual close produces.
- **`MilestoneDrawer`'s Start/Close are unchanged, deliberately** — they remain a manual override
  available whether or not a milestone has stages, rather than being redesigned around stages. All
  of the auto behavior above is additive, on the stage-status endpoint only; no drawer code needed
  to change for a milestone that happens to have stages.
- **Auth mirrors the milestones route**: a head may only touch a milestone (or a template — scoped
  by its own `department` column) in a department they're granted (`canAccessDepartment`); a PM can
  touch any. Every write is audited (`stage_added`/`stage_renamed`/`stage_removed`/
  `stage_status_change`/`stage_template_applied` for the instance side;
  `stage_template_created`/`renamed`/`defaulted`/`deleted` and `stage_template_item_added`/
  `renamed`/`removed` for the template side) via the shared `audit()`.

## 3d. Operations tab — standards for every department's dashboard card

Each department that shows up on `/` (Operations) gets one Card near the top of its filtered view —
Procurement, Sales, Stores, Production, and Design shipped first (in that order) and set the pattern
documented here. This section exists so the *next* department's card is built to the same rules
instead of reinvented — every file below says so in its own header ("same node/spine shapes as
X.jsx, copied not abstracted").

### Flow diagram

The centerpiece of a department's card is a **flow diagram**: an ordered row of stage boxes
connected by a spine, each box showing a **live count of real rows currently in that state** — never
a static/decorative diagram. It answers "where do things stand right now" at a glance, and every
number is a real query result, not a placeholder.

**Ground rule — a stage must be a real, queryable DB state.** Before adding a department's flow
diagram, find the actual status column/lifecycle its data already has (`bom_change_notes.status`,
`work_orders.status`, a packing list's `Pending → Ready → Dispatched`, etc). If a department's real
data is a flat list or a tree with no forward-progressing status field, it does **not** get a
multi-stage spine — inventing stages that don't correspond to a real column is worse than no
diagram. (Engineering is the one department this ruled out for the 2026-08-20 rollout — see §5o;
its only real state machine is ECN's 3-way pending/approved/rejected split, not a spine.)

**Shape, copied file-to-file (`components/{Dept}Flow.jsx`):**

- `STAGES` (or `LIFECYCLE`) array of `{ key, label, tone, help }`, in real pipeline order.
- `TONE_CLASSES` — a fixed small vocabulary (`plain`/`enquiry`/`comparison`/`ordered`/`transit`/
  `warning`/`received`/`danger`/`in_stock`) reused verbatim across every flow file, and matching the
  same tone names `lib/bom-fields.mjs`'s `STAGE_BAR_COLORS`, `BomStageBar.jsx`, and
  `PortfolioDelayTimeline.jsx` use — one color vocabulary across the whole app, not a new palette per
  department. A "bad" stage (Cancelled, Rework) gets a faint background wash and label-color change
  only — never a heavier border/size — so no stage reads as visually alarming relative to its
  siblings (explicit client feedback on Procurement's Cancelled box, honored everywhere since).
- `StageBox` — one node shape, same border/size/shape regardless of tone; a value number, a label,
  and an `InfoButton` (a `Popover` with the stage's `help` text) beside the label. Every stage gets a
  `help` string explaining exactly what real-world state puts a row in that bucket — this is the
  only place that meaning is written down, so write it precisely.
- Desktop: a horizontal spine — node centers evenly spaced via `(i + 0.5) * (100 / STAGES.length)`
  (never hand-placed pixel positions), a border-color connecting line, and a small `ChevronRightIcon`
  arrow at each midpoint.
- Mobile (`sm:hidden`): the same stages as a vertical stack of numbered circles connected by a
  vertical line (`StageRowVertical`) — never just hidden or horizontally scrolled on narrow screens.
- Card chrome: `CardHeader` with the department name as `CardTitle` and a `CardAction` button linking
  to that department's own workspace ("Open {Dept} workspace →").

**Extensions, used only when the real pipeline actually needs them — don't add one speculatively:**

- **Branches** (Procurement's Cancelled, Production's Rework) — an SVG connector off the main spine
  for a real alternate/terminal outcome, not a new primary stage. Any SVG path in one of these files
  must set `vectorEffect="non-scaling-stroke"` — the connector SVG's `viewBox` is stretched
  non-uniformly to the diagram's pixel width, so stroke width scales with that transform unless
  pinned (ProcurementFlow.jsx's v4→v5 history is the record of this bug and its fix — don't
  reintroduce it).
- **A small "Sources" row** (Stores) — when a pipeline has more than one real entry point, list them
  as small plain-tone boxes above the spine with a `ChevronDownIcon` into it, rather than drawing
  literal multi-source merge geometry.
- **Two spines in one card** (Production) — a primary cross-project lifecycle plus a secondary
  status spine for records that can skip the primary one entirely (ad hoc Job Cards). Labeled
  "(secondary)" and visually separated by a `border-t`, not blended into one row.
- **`href` per stage, making the count a drill-through link** (Production) — when a stage's count
  corresponds to a real filtered view/list elsewhere in the app, link the value+label into it
  (`/production/workers?tab=workorders`, etc). `InfoButton` must stay a sibling of the link, never
  nested inside it — a `<button>` (the Popover trigger) inside an `<a>` is invalid HTML and breaks
  click handling.
- **Non-stage indicator chips** (Production's Route/Material/Labour/Costing/Forecast row) — small
  pill links for real supporting metrics that aren't sequential pipeline stages, sitting above the
  spine, not merged into it.
- **`bare` + dual `counts`/`activeStage` modes** (Design) — `bare` renders the diagram's content
  without the Card wrapper, for embedding inside another card. `activeStage` (single-project view)
  swaps the value-number boxes for done/current/upcoming state (check / ring-highlight / dimmed) —
  used on the project page; `counts` (cross-project Operations view) is the default aggregate mode.
  Only add this when a department genuinely needs both a per-project and a cross-project view of the
  same pipeline — most departments only need `counts`.

**Wiring a new one in:**

1. A `get{Dept}FlowCounts()` function in `lib/data.js`, next to the existing five, doing the real
   `GROUP BY status`-shaped queries against `lib/db.js`'s schema.
2. Import + render in `app/page.js`'s Operations view, gated the same way as the existing five:
   `deptsToShow.includes('{Dept}') ? await get{Dept}FlowCounts() : null`, rendered right after the
   KPI chips and before the per-project breakdown — the flow diagram is the highest-value thing on
   this page for "where do things stand," so it goes first.

### 2026-08-20 rollout — the remaining six departments

Applied the ground rule above to each of Engineering/QC/Dispatch/Installation/HR/Marketing before
building anything — the real schema decided the shape, not the template:

- **Dispatch** (`DispatchFlow.jsx`, `getDispatchFlowCounts`) — the plainest case: one table
  (`packing_lists`), one status column, 3 literal values (`draft`/`packed`/`dispatched`), no
  branch/cancel concept. Rendered inside the Dispatch department view itself (`app/page.js`'s
  `dept=Dispatch` branch, right above `DispatchBoard`) rather than as a separate workspace link,
  since that view already *is* the Dispatch workspace.
- **Installation** (`InstallationFlow.jsx`, `getInstallationFlowCounts`) — a real 5-state spine off
  `service_calls.status` (`open → assigned → in_progress → resolved → closed`, an enforced state
  machine in `app/api/service-calls/[id]/route.js`). Service Contracts is deliberately **not** a
  second spine — a contract's real states are terminal outcomes
  (`active → expired/renewed/cancelled`), and `renewed` inserts a brand-new contract row rather than
  advancing the same one — so it surfaces as four small count chips above the spine instead (the
  "non-stage indicator chips" extension).
- **HR** (`HrFlow.jsx`, `getHrFlowCounts`) — a real 4-stage headcount spine
  (`onboarding → active → separation → exited`) off `employee_onboarding`/`employee_separation`/
  `employees.active`. Recruitment (`job_applicants`) and payroll runs are real pipelines too but a
  different axis entirely (who's hired vs. who's on payroll this run) — left as candidates for their
  own smaller widgets later, not merged into this spine.
- **QC** (`QcFlow.jsx`, `getQcFlowCounts`) — the statutory-document pipeline
  (`test_certificates` uploaded → allocated via `certificate_projects` → `qc_documents` with parts
  still unlinked → finalized), read cross-project like `/qc` itself, not project-scoped like
  `QcPanel`. `qc_records` (hydro test/NDE/MTC results) is a flat pending/pass/fail tally, not a
  lifecycle — it rides as a secondary row (same precedent as Production's secondary Job Card spine)
  instead of being stretched into fake stages on the main one.
- **Engineering** (`EngineeringFlow.jsx`, `getEngineeringFlowCounts`) — deliberately the smallest of
  all six: `bom_change_notes.status` (ECN) is Engineering's only real state machine, a 3-way
  pending/approved/rejected split, not a multi-stage spine. BOM structure building, Where-Used, and
  Common/Uncommon are tree/classification views with no forward-progressing status column, so this
  ground rule excluded them rather than inventing stages for them. Calc Sheets stays entirely
  `DesignFlow.jsx`'s own — this card covers only Engineering's own ECN data, on the shared
  `/engineering` tab (Design/Engineering also share `/calc`).
- **Marketing** — no new card. It shares Sales' entire workspace and `SalesFlow.jsx` already renders
  whenever a Marketing head's `deptsToShow` includes 'Sales' via the same shared-tab mechanism
  Nav.jsx uses (`addDeptTab(['Sales', 'Marketing'], ...)`) — a second card would just duplicate it.

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
   card on Operations for BOM-owning heads. Also reused by Production's cross-project BOM tab
   (§5g) — same component, same fix below, not a separate implementation.
   - **Sticky-column bug fixed (2026-08-16):** the pinned `#`/Description/Status/Packing/Actions
     columns' `left` offsets were hardcoded pixel values assuming each column renders at exactly
     its declared `w-*` width. The table's default `table-layout: auto` let the browser shrink a
     column below that (confirmed: `#` rendered at 25px against a declared 48px), so the offsets
     stopped matching reality and the scrolling department-specific columns (Make, PR/PO/GRN refs,
     etc.) physically overlapped the sticky ones at rest, not just mid-scroll — text clipped
     mid-word regardless of scroll position. Fixed with `table-fixed` on `BomTable`'s own `<Table>`
     (not the shared `ui/table.jsx` primitive — other tables in the app lack this column's
     per-field width discipline, so forcing it globally would likely break them) plus explicit
     widths on every department-specific column, which `table-fixed` requires to avoid squeezing
     them into an even, too-narrow split. Verified live against SB-1104's real BOM.
   - **Follow-on: two `min-w-0` gaps, same underlying pattern.** Making the table properly wider
     exposed two flex-container ancestors that were never told they're allowed to shrink below
     their content's intrinsic width, so instead of the table scrolling internally, the whole page
     grew a horizontal scrollbar. Fixed in two shared primitives (not `BomTable` — every page using
     either): `ui/table.jsx`'s own scroll wrapper div (`min-w-0` added alongside its existing
     `overflow-x-auto`), and `ui/sidebar.jsx`'s `SidebarInset` (`main`, the content area every
     sidebar-based page sits in) — `flex-1` never implies `min-width: 0` on its own, and this was
     the one actually missing it. Both fixes only take effect when content would otherwise
     overflow, so neither changes anything for a page that already fits. Verified live.
5. **Audit:** imports, replaces, item adds/edits/deletes all write `usb_audit` rows
   (`bom_import` / `bom_replace` / `bom_item_add` / `bom_item_edit` / `bom_item_delete`) via the
   shared `audit()`.
6. **Parser self-check** (no JS test framework, same precedent as the agent's `--selftest`):
   `node lib/pmb-selfcheck.mjs` (synthetic fixtures) or point it at a real workbook to print
   per-sheet mapping/counts/skips.
7. **Procurement's real process, modeled directly** (this round): sourcing → compare pricing →
   release PO all sit under `PENDING` (the item's own `po_ref` presence is the finer signal —
   blank means still sourcing, filled means a PO exists even though the status hasn't moved to
   `TRANSIT` yet) → `TRANSIT` while following up with the vendor → `CLOSED` on delivery, with a
   `CANCELLED` exit that only Design/Engineering can trigger (they own no BOM fields, so it goes
   through a **cancel-request task**, not a direct edit). `components/ProcurementQueue.jsx`, mounted
   above the BOM table on Procurement's own department panel, is Procurement's real day-to-day
   worklist: **Sourcing / PO placed / In transit** counts derived client-side from the same `bom`
   data already on the page (no new query), plus a **Cancel requests** list — checkbox per row, a
   "select all," and one **Accept selected** action that marks the request(s) done and flips the
   item(s) to `CANCELLED` in a single `POST /api/production/tasks/accept-cancellations` call.
   Raising one happens from the existing cross-department `Raise` dialog (`TicketsPanel.jsx`) — a
   third "Cancel BOM item" kind, offered only once "Procurement" is the target department, that
   picks a live BOM line (excluding anything already resolved or already requested) instead of
   free-typing a title. The task/item link is a single `tasks.bom_item_id` column — no new "kind"
   enum, since a `bom_item_id`-linked task *is* a cancel-request by construction; extend this if a
   second BOM-linked task type is ever needed. `CLOSED`/`RECEIVED`/`CANCELLED` are all treated as
   "resolved, not open work" everywhere a BOM open-count is computed (`getBomWork`, `getBomRollup`,
   `getBomRollupAll`) — a cancelled item stops showing up as something anyone needs to chase. The
   fuller cross-project sourcing/quotes/PO system this process feeds into is §5c.

Deliberately **not** built (v1 decisions): document management for drawings/IBR, release/approval
workflow for BOM revisions, Excel export/back-sync, in-app BOM authoring from scratch (the
add/edit/delete APIs are 90% of it — natural v2), supplier/lead-time analytics. The Purchase Order
PDF and Supplier Selector named here in earlier rounds are **built** — see §5c. QC statutory
certificate documents (Form IV A) are also now **built** — see §5d.

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

## 5c. Procurement system — requests, sourcing, quotes, selection, purchase orders

Fully redesigned this round (full history/decisions in `PROCUREMENT-CHANGES.md`, kept as the
record — this section is the as-built result). Procurement's real process: a request from
Engineering/Design → accepted → contact suppliers → compare pricing → select a supplier → PO drafted
→ PO issued → delivered/closed, with a cancel exit at any point. Three surfaces: the **Requests**
tab (the front door — new-item/cancel requests wait here until accepted), the cross-project
**`/procurement`** workbench (`app/procurement/page.js`, gated `canAccessDepartment(user,
'Procurement')`, own Nav tab), and `ProcurementQueue.jsx` (the project-page glance, unchanged).
`/procurement` exists as a cross-project surface because a PO can span projects — the same MS angle
gets bought once for several boilers, not per project.

### Requests tab — the acceptance gate

`app/requests/page.js`, own Nav tab (same gating as Procurement). Two modules:

- **New-item requests** (`procurement_requests` table) — Engineering/Design raise one via a new
  **"Request procurement"** kind on the cross-department Raise dialog (`TicketsPanel.jsx`), only
  offerable from a project page (a request needs a project to attach to — same reasoning as the
  existing "Send back (rework)" kind's `canReopen` gate). A request is **not** a `bom_items` row —
  it doesn't show up anywhere in Procurement — until accepted: `PATCH
  /api/procurement-requests/[id]` with `{action:'accept'}` inserts the `bom_items` row
  (`purchase_status='PENDING'`) and stamps the request `accepted`/`bom_item_id`; `{action:'reject'}`
  just closes it out, no row ever created. Fires a `notifyDepartment('Procurement', ...)` on raise,
  matching the existing cross-department task-raise precedent.
- **Cancel requests** — unchanged flow (still `tasks.bom_item_id` +
  `POST /api/production/tasks/accept-cancellations`, §5a point 7), just surfaced in this same inbox
  instead of only the project-page queue. `procurement_requests` deliberately doesn't model cancel
  requests too — no reason to migrate a flow that already works.
- **Split Tickets** — "Raised by Procurement" / "Raised for Procurement" (two `TicketsPanel`
  instances, filtered by `from_department`), moved here from Operations (§3) where it used to be one
  mixed feed under Procurement's own tab.

### `/procurement` — four tabs (`components/ProcurementWorkspace.jsx`)

- **Sourcing** — accepted items with no supplier picked yet (`!selected_quote_id`, not
  resolved/`TRANSIT`). Each row expands to its logged quotes + an **Add quote** dialog: vendor
  (existing or add-new inline), price + UoM, **payment terms** (`PaymentTermsField` — LC / Advance %
  (reveals a 10–100%, step-10 picker) / After Delivery / PDC / COD / free-text "add new option"),
  and **expected delivery as a calendar date** (`supplier_quotes.expected_delivery_date`, new column
  — the original `expected_delivery_days` integer stays for back-compat, unused by new quotes).
- **Selection** — items with ≥1 quote (regardless of whether one's already picked, so Undo has
  something to act on). Side-by-side quote comparison with **Lowest price** / **Fastest delivery**
  labels; Select/Undo via the existing `POST`/`DELETE /api/bom-items/[id]/select-supplier`, now also
  driving **auto-draft POs**: selecting adds the item to (or starts) that supplier's one open `draft`
  PO; Undo pulls it back out, deleting the draft if it's now empty (`lib/procurement.js`
  `addItemToDraftPO`/`removeItemFromDraftPO`, called from the select-supplier route). This replaced
  the old explicit "select several items, then Create PO" flow — a PO now starts existing the moment
  a supplier's picked, not as a separate step.
- **Purchase orders** — drafts (from Selection, terms editable here before issuing) + issued +
  cancelled. **View** (PDF) / **Issue** / **Cancel Issue**. Issuing now also flips each line's
  `purchase_status` to `TRANSIT` if it was still `PENDING` (previously only stamped `po_ref`) and
  opens the PDF. **Cancel Issue** is a new `unissue` PATCH action — back to `draft`, items revert
  `TRANSIT`→`PENDING`, `po_ref` stays (the PO document still exists, just not sent) — distinct from
  the pre-existing permanent `cancel` action (still available separately; returns items to "on
  order," not back to draft, and doesn't touch `po_ref`).
- **Status** (labeled "State" in the original spec, renamed in the Phase 4 polish pass, §"Phase 4"
  below) — every accepted item, always (the one tab that isn't lifecycle-scoped, so a status is
  never impossible to find or fix). Search + a status filter + Part Description/Spec/Size/Qty/PR
  ref/PO number/Make + an always-editable **STATUS** dropdown (`PENDING` gray / `TRANSIT` orange /
  `CLOSED` green / `CANCELLED` red / `RECEIVED` green — kept as a 5th status for Stores' receipt
  signal, just not emphasized) that manually overrides whatever the automatic flow set, reusing the
  existing `PATCH /api/bom-items/[id]`.
- **Suppliers** — unchanged 5th tab (add/edit/deactivate); not named in the redesign spec but a
  real, working feature kept rather than dropped.

`po_no` is still the single global sequence (`NNN/SB/YYYY-YY`, Indian financial year,
`counters.po_no` seeded at 578) continuing the real business's numbering — draft creation (whether
via the old explicit flow's remnants or the new auto-draft) uses the same format. **PO PDF**
(`lib/po-pdf.js`) is unchanged — mirrors `lib/packing-pdf.js`'s approach, matches the two real sample
POs' layout.

### Operations & project page (§2/§3 changes, redesign §2/§3)

- **Operations' Procurement view**: `ProcurementFlow.jsx` replaced the old Sourcing/PO-placed/
  In-transit tiles with a left-to-right pipeline — `Requests → Sourcing → Selection → PO issued →
  Closed`, plus a separate `Cancelled` tile (an item can drop out at any stage, not just the end).
  Counts come from `getProcurementFlowCounts()` (`lib/data.js`), a **strict partition** unlike the
  workspace's own tabs (which deliberately overlap for editing convenience) — every active item
  falls into exactly one bucket, so the numbers sum to the whole. Each stage has an info popover
  (plain-English, one line) explaining what it means. A Sankey was considered and rejected: the
  pipeline is one branch (Cancelled) short of the crossing-category structure that would justify one,
  and with sparse data it would read as broken the way the old segmented counts did before real
  quotes existed (see the investigation notes in `PROCUREMENT-CHANGES.md` §1).
- **"Waiting on" card removed globally** (not just for Procurement) — checked live data first: across
  the entire app, only one milestone has ever had a `delay_category` set, so the card was fully
  redundant with Open Actions (next) everywhere, not a Procurement-specific problem.
- **"Needs Attention" → "Open Actions"**, also global (Operations' per-project cards and the project
  page's `TodayBand`) — same card, same data, now split into **Urgent** (not yet delayed, closest
  `planned_end` first) and **Needs attention** (already overdue/blocked) instead of one
  severity-sorted list.
- **Project page, Procurement-specific**: `DepartmentPanel` no longer renders the plain `BomTable` or
  the Tickets/Raise card for `department === 'Procurement'` — BOM work lives entirely in
  `/procurement`, and requests arrive via the Requests tab, not this page's Raise dialog. Every other
  department's project-page section (BOM table where they own one, Tickets/Raise) is unchanged.

### Still true from before this round

- **Field-level BOM ownership** (§5a) unchanged — Procurement owns `purchase_status`/`pr_ref`/
  `po_ref`. Its **column view is scoped** (Stores/Production are not, yet — deliberately, opt-in per
  department as each one's needs get confirmed the same way): `lib/bom-fields.mjs`'s
  `visibleBomColumns(department, allColumns)`/`showPackingColumn(department)`, gated by
  `SCOPED_BOM_VIEW`. This only matters where the plain `BomTable` still renders for Procurement (it
  no longer does, per above) — kept as the mechanism for Stores/Production's eventual scoping.
- **Deliberately deferred, schema left with room**: fine-grained line-splitting across suppliers (no
  UI exists for it, `purchase_orders.is_split` only set if a future flow passes it); units as an
  Engineering-owned structured attribute (`uom` stays free text); a supplier-facing portal (schema's
  ready); a PO approval threshold; buy-now-price-later; quote expiry (`valid_until` exists, not
  enforced); quote **correction** (a bad price is superseded by a new quote, never edited/deleted in
  place — no `PATCH`/`DELETE` route on `supplier_quotes`, deliberately, to keep the price-history log
  honest). **Stores' own equivalent queue is still not built** — its trigger is still an open
  question pending a workflow conversation.
- **GST is still a flat percentage, not IGST vs CGST+SGST** — `lib/po-pdf.js` renders one "GST @ X%"
  line; real Indian tax law depends on whether the supplier is in Shanti's state (Telangana), which
  needs a supplier `state` field this build doesn't have. Flagged, not fixed — needs a business-side
  answer.
- **Suppliers table** (`suppliers`) still deliberately provisional — the client's real supplier list
  is coming separately.

### Phase 4 — premium UI polish pass

A follow-up round after using the shipped redesign live — nav/layout/interaction refinements, no new
business process. Full investigation notes (including two real bugs found while verifying) in
`PROCUREMENT-CHANGES.md` §9.

- **Nav**: Requests sits before Procurement (it's the inbox that feeds the workspace).
- **`/procurement` tab bar** (`ProcurementWorkspace.jsx`): Sourcing/Selection/Purchase
  Orders/Status stay left-aligned; **Suppliers** — a standalone feature, not part of the other four's
  shared lifecycle — sits pushed to the far right of the same bar. **One shared search input** lives
  directly under the tab bar, same position regardless of active tab, with a per-tab placeholder;
  Sourcing/Selection/Status lost their own private search boxes in favor of it, Purchase Orders and
  Suppliers gained search for the first time. **Column headers** added to Status and Purchase Orders
  (both genuinely tabular); deliberately not added to Sourcing/Selection, whose rows are variable
  card content, not a fixed grid. **Status filter** dropdown (all/PENDING/TRANSIT/CLOSED/CANCELLED/
  RECEIVED) sits in the same search row for the Status tab — reintroduces the equivalent filter the
  pre-redesign `BomTable` had.
- **Fulfilled POs**: `getPurchaseOrders()` returns a `fulfilled` flag (every line item resolved, or
  the PO itself cancelled) — a two-way Active/Fulfilled toggle with live counts in the Purchase
  Orders tab's search row keeps resolved POs from accumulating in the default view.
- **PO View**: no longer a new browser tab — a right-side drawer with the PDF inline
  (`<iframe src=".../pdf">`, the route already serves it inline, no backend change) and
  Issue/Cancel Issue/Cancel in the drawer footer. **Issue** now triggers a real file download
  (fetches the PDF as a blob) instead of `window.open`.
- **Cancel-request detail overlay** (`RequestsWorkspace.jsx`): clicking a cancel-request (the bulk
  checkbox flow still works alongside it) opens the item's spec, requesting department + reason, the
  selected supplier if any, the issued PO if any (`getBomItemPoInfo()`, new), and every other quote
  that was logged but not picked (`getItemQuotes()`, already existed, now used here) — before
  "Accept & cancel item" flips it through the existing `accept-cancellations` route.
- **Operations Procurement flow diagram** (`ProcurementFlow.jsx`) rebuilt as one continuous spine
  (an SVG connector layer sharing coordinates with the HTML node labels) with **Cancelled** as a
  real, visually connected branch off Sourcing/Selection/PO-issued specifically — not Requests
  (before it's even a BOM item) or Closed (already done).
- **Master BOM card on Operations**: each project row now shows a stacked closed/transit/pending bar
  (`getBomWork()` gained a transit count) instead of a bare open-item count.
- **Two real bugs found and fixed while building/verifying this pass**: the seed script wrote
  `expected_delivery_days` (an int) but the UI only ever read the newer `expected_delivery_date`, so
  every seeded quote silently had no delivery date and "Fastest delivery" never lit up; and
  `getPurchaseOrders()`'s fulfilled-check used `purchase_status NOT IN (...)` without accounting for
  `NULL` (SQL's three-valued logic drops NULL rows out of a `NOT IN` count entirely), so a draft PO
  whose items had never had their status explicitly set read as wrongly "fulfilled." Both fixed;
  the second one caught live via a direct DB query showing the miscount before the fix.

### Suppliers — merged into one nav item, Roster + Analysis, Analysis gets a Dashboard (2026-08-18)

STERP-parity items "Vendor Analysis," "Vendor Rating," and "Purchase Card" (STERP.md Priority 1)
— built as a read-only report, no schema change, entirely derived from `supplier_quotes` and
`purchase_orders`/`po_items` that Procurement already logs. Named "Suppliers" throughout, never
"Vendor" — the app already has one word for this entity; introducing a second one on a
neighboring tab reads as a different entity to a new user, not a synonym.

- **One `Suppliers` nav item, two sub-views, not two flat tabs.** `WorkspaceSidebar.jsx` gained
  `group`/`children` support on a flat `items` entry — a parent row that expands into
  `SidebarMenuSub`, the exact same pattern `DepartmentHelpWorkspace.jsx`'s Notifications entry
  already used, now shared rather than reimplemented a second time. `ProcurementWorkspace.jsx`'s
  nav is `{key:'suppliers', group:true, children:[{key:'suppliers-roster', label:'Roster'},
  {key:'suppliers-analysis', label:'Analysis'}]}` — Roster is the existing add/edit/deactivate
  contact list (unchanged component), Analysis is the new report.
- **`components/SupplierAnalysis.jsx`** (renamed from the first pass's `VendorAnalysis.jsx`) — a
  3-way Dashboard / By Supplier / By Item toggle in the shared search row (same idiom as the
  Purchase Orders tab's Active/Fulfilled toggle), **Dashboard is the default view**.
  - **Dashboard**: portfolio-level stats (active suppliers, quotes logged, total issued-PO spend,
    overall win rate), a 6-month issued-PO spend trend (`BarList`, one bucket per month), top
    suppliers by spend, top win rate (2+ quotes only, so a single lucky quote doesn't read as
    100%), and most-quoted materials — five real views built from the same aggregation the other
    two tabs use, not new data.
  - **By Supplier**: every active supplier ranked by issued-PO spend (`purchase_orders.status =
    'issued'` only — draft/cancelled POs aren't real spend), with quote count, quotes won
    (`supplier_quotes.is_selected`), win rate, and PO count. A top-8-by-spend `BarList` sits above
    the table; clicking a row expands that supplier's full quote history inline.
  - **By Item (Purchase Card)**: groups all logged quotes by `material_description` text (exact
    match, not fuzzy — a differently-typed description is a separate card, called out as a
    watch-out in the help copy), most-quoted first as a chip list. Selecting one shows every
    supplier who's quoted it, cheapest/most-recent stats, and — once there are 3+ quotes to plot —
    an inline-SVG price-trend line, same no-dependency idiom as `CalcWorkspace.jsx`'s
    sensitivity-sweep chart.
- **`components/ReportKit.jsx`**, new — `BarList`/`StatRow`/`ReportShell` (the bar-chart idiom,
  stat-chip row, and Card+"Download PDF"-via-`window.print()` shell) extracted out of
  `CrmReportsWorkspace.jsx`, which now imports them instead of defining its own copy. Shared by
  both report surfaces rather than duplicated once a second one existed.
- **Fixed as a side effect**: `getAllQuotes()` (`lib/data.js`) was missing the `bom_items`/`projects`
  join — Roster's per-quote line (`{material_description} · {project_no}`) was silently rendering
  `undefined · undefined` for every row. Both are safe inner joins (`bom_item_id`/`project_id` are
  `NOT NULL`); fixing the query fixed both call sites.
- **Deliberately not built: an on-time-delivery % or composite supplier rating.** `bom_items.
  received_ref` (Production's "received qty + date") is free text, not a structured date — there is
  no honest way to diff it against `supplier_quotes.expected_delivery_date` yet. Faking a score off
  unstructured text would be worse than not having one. Needs `received_ref` split into real columns
  first, a real follow-up, not part of this round.
- **Help page**: the Procurement guide's feature group is now `key: 'suppliers'`, label
  "Suppliers," matching the app nav 1:1 — four children: "Roster" (new content — add/edit/
  deactivate, the dedupe rationale), "Analysis — Dashboard," "Analysis — By Supplier," "Analysis —
  By Item (Purchase Card)," each with the standard Why/How/Work-through/Avoid/Done-when framework.

### Project filter — Enquiry and Selection (2026-08-18)

A `Select` next to the shared search input on the Enquiry and Selection tabs, same right-aligned
slot the Status tab's status filter already uses. Picking one narrows both tabs (the filter is
lifted to `ProcurementWorkspace`'s root, alongside the existing free-text search) rather than being
scoped per-tab, so switching between Enquiry and Selection keeps the same project in view.

The option list is **not** plain `activeItems` (that only drops `Cancelled`) — it's `activeItems`
further filtered to `!OUT_OF_PIPELINE.includes(purchase_status)`, the same
`[...CLOSED_STATUSES, 'Ordered', 'Transit']` cut both `Enquiry` and `Selection` already apply to
their own rows (line ~35). First pass got this wrong: it listed every project with any
`release_bom`-cleared item ever, so a project already fully Ordered/Transit/Received/In-Stock —
genuinely past Procurement's Enquiry/Selection concern — still showed up, reading as "stuck in
Procurement" when it wasn't. Fixed same day, live-verified: the option count on the seed data
dropped from 6 projects to the 2 that actually have open Enquiry/Selection work.

## 5d. QC statutory documents — Test Certificate bank + statutory folder

Full history/decisions in `QC-CHANGES.md` (the original investigation record). This section is the
**current as-built** and has moved well past that record — read this, not just QC-CHANGES.
Client's real requirement: every boiler ships a statutory **folder** for the Directorate of Boilers,
built from the Material Test Certificates (TCs) that plates/tubes/forgings arrived with. Today the
app fully implements the **Test Certificate bank + Form IV A**; the rest of the folder (other forms,
covering letter, stage-wise report) is understood but **not yet generated** — see "The real folder"
and "Next" below.

### Data model (phase 2 — cert↔project is many-to-many)

- **Test Certificate bank** (`test_certificates`) — the whole bank, **globally unique** on
  **Cert No. + Cast No. + Plate No.** together (never Cert No. alone — one cert number covered 4
  casts in the sample). A cert is one physical material entered once, then **used in many projects**
  (one plate is cut into parts across several boilers — real sample showed ~3.2× reuse). The
  cert↔project link is a **many-to-many join, `certificate_projects`**; a cert may have **zero**
  projects (uploaded, not yet allocated) and gain them over time. The old single
  `test_certificates.project_id` column is **vestigial/retired** (kept, all-NULL, `ponytail:` note
  to drop later) — do not use it; use the join table.
- **Auto-associate**: linking a document part to a cert (`app/api/qc-documents/[id]/link-parts`)
  inserts the cert↔project row for that document's project automatically — using a cert on a
  project's folder *is* what allocates it to that project.
- **Equipment model on the project** — `projects.series` holds one of **CF, MF, OF, SF, SIB, PRS,
  FCB, FAB** (`lib/qc-series.js`; the DB column is named `series` for historical reasons but the
  business term is **model**). It is **NOT a project-number prefix** — it sits in a fixed mid-segment
  of the structured project code, e.g. `STF-IBR-045-`**`CF`**`-400-15`. Set **only at project
  creation** (`components/NewProjectForm.jsx`, "Model" field; `app/api/projects` POST stores it,
  number stays manual/legacy `SB-####` — the full code's segment meanings aren't formalized).
  Backfilled for existing projects by parsing the model segment out of `project_no`
  (`scripts/qc-reassign-certs.mjs`).
- TC PDF: each cert can carry its source PDF in R2 (`pdf_key`/`pdf_url`), AI-extracted on upload
  (`app/api/test-certificates/extract`, `components/CertForm.jsx` + `PdfInlinePreview`).

### UI (phase 2 — one workspace, two tabs)

- **`/qc` workspace** (`components/QcWorkspace.jsx`, QC-department-gated in `Nav.jsx`) — two tabs via
  `WorkspaceSidebar`: **Test Certificates** (`TcBank.jsx`) and **Documents**
  (`StatutoryDocsPanel.jsx`, cross-project here). Header has two **searchable** selectors
  (`components/SearchableSelect.jsx`): **Model** (left) narrows the **Project** list; picking a
  project auto-selects its model; neither set → every QC-relevant project (see below), not literally
  every active project. Projects sorted newest-first. Certs are
  cross-project with project chips; adding a cert is always available (project(s) optional, multi-
  select). Creating a **document still requires a project** (a folder is 1:1 with a boiler/project).
- **QC project filter (2026-08-21).** The `/qc` project picker used to list every active project —
  including ones Engineering hasn't even imported a BOM for yet, which QC has no real business
  with. `app/qc/page.js` now scopes it to `getReceivedProjectIds()` (`lib/data.js` — any project
  with ≥1 `bom_items` row at `Received`/`In-Stock`, the point Stores starts handing QC material to
  inspect), unioned with any project already in the cert/doc bank so nothing already worked-on ever
  drops out of the list. Live-verified: the picker narrowed from 12 active projects to the 5 that
  actually have received material.
- **Project → QC tab** (`components/DepartmentPanel.jsx`, `department === 'QC'`) shows `QcPanel`
  (§5b, the pass/fail test log — a different job) **+** `components/QcProjectSummary.jsx`: a read-only
  roll-up (certs uploaded / with PDF, docs finalized / total) with **Manage** buttons that deep-link
  into the `/qc` workspace (`?tab=&project=`), gated to QC-access users. The full add/edit lives in
  the workspace now, not this tab.
- **Statutory documents** (`qc_documents` + `qc_document_parts`) — per-boiler. **New document** seeds
  the Form IV A part list from a hardcoded template (`lib/qc-template.mjs`, 54 parts, SF sample) —
  every part starts unlinked. The editor (`QcDocumentEditor.jsx`, `/projects/[id]/qc/[docId]`) has
  search, an Unlinked filter, and multi-select **bulk-link to one certificate**; the picker
  (`CertPicker.jsx`) reaches the whole bank, shows cert+cast+plate+spec+maker together, and has
  inline **"+ Add certificate"**. Company/letterhead per document comes from a two-value list in
  `StatutoryDocsPanel.jsx` (Shanti Boilers `SBH` / Shanti Techno Fab `STF`) — **no longer
  incomplete** (2026-08-16): a new document now defaults to the *project's own* `company` (§5g)
  instead of always Shanti Boilers, and the two-value list itself is no longer duplicated three ways
  — `lib/qc-doc-pdf.js` exports `COMPANY_NAMES`/`companyProfile()` as the one source both
  `qc-documents` routes and the PO/payslip PDFs (§5g) now import.
- **The hard gate**: *Preview PDF* is disabled while any part is unlinked, and
  `app/api/qc-documents/[id]/pdf/route.js` re-checks server-side and 409s — the UI gate is never the
  real enforcement.

### PDF rendering (still Form IV A only)

- `lib/qc-doc-pdf.js` (`@react-pdf/renderer`, modeled on `lib/po-pdf.js`) — landscape Form IV A, 18
  columns, generated live per request. In-app preview `components/PdfPreview.jsx` renders to
  `<canvas>` via `pdfjs-dist` (not an iframe — iframes depend on the browser's PDF plugin). **Build
  gotcha**: use `pdfjs-dist/legacy/build/pdf.mjs` (the modern build's private-class-field syntax
  breaks Render.com's Terser), and serve the worker as a **plain static file**
  `public/pdf.worker.min.mjs` (`scripts/copy-pdf-worker.js`, `postinstall` + committed) — webpack
  asset-module bundling of it fails Next's production Terser pass.

### The real folder (from the sample set — understood, generation NOT built yet)

Real filled samples live at **`/Users/pujan/Developer/FOLDER SAMPLE - FOR APP/`** — one folder per
model (CF, MF, OF, SF, SIB, PRS, HEADERS) plus a shared STAGE WISE REPORT. Read them (they're the
source of truth for layouts). **The full field-by-field design analysis — what's fixed vs variable in
the label, covering letter, mounting list, and each form, and the new data needed — is in
`QC-FOLDER-DESIGN.md`** (also the source for the QC help page). Key facts a new AI must know:

- **A complete folder is much more than Form IV A.** Filed order (from the covering letters):
  covering letter (submission to the Director of Boilers, listing the folder's manifest) →
  documentation label → the **forms workbook** → list of mountings & fittings → stage-wise material
  certification/inspection report → the TC copies themselves.
- **Which forms exist differs by model** (each form is its own sheet in the model's `.xlsx`):
  - CF / MF / OF: **Form II(1) + III + III A + IV A**. SF: same four **+ a Mountings sheet**.
  - SIB (Small Industrial Boiler): **Form XVII** (Chapter-XIV small-boiler cert) instead of
    II(1)/III, **+ III A + IV A**.
  - PRS (Pressure Reducing Station) / HEADERS (Steam Header): **Form III + Form IV A (labelled
    "4A")** only — no II(1)/III A.
- **Legal entity is selected by the maker-number prefix, not picked by hand** — `STF-` → **Shanti
  Techno Fab Pvt Ltd**, `SB-` → **Shanti Boilers & Pressure Vessels (P) Ltd**. These are the *same two*
  entities the current `COMPANIES` list has, but the first's real legal name is "Shanti Boilers &
  Pressure Vessels" (the list says just "Shanti Boilers") and selection should follow the prefix. The
  folder's letterhead, ref prefix, and signatories all follow the entity.
- **Form III A** is a per-part TC table like IV A but scoped to one named part (e.g. the feed
  pipeline) and carries **extra columns not in IV A nor stored on `test_certificates`**: *Steel
  Making Process* and *Heat Treatment*. **Form III** is the boiler description block (dimensions,
  pressures, heating surface, evaporation, steam temp — overlaps `qc_documents` meta) + parts-
  manufactured list + construction/seams + drums/headers tables (often "Not Applicable") + mountings
  ref + safety-valve test. **Form II(1)** is the inspection certificate (inspecting authority, W.P.,
  hydro test pressure + date, drawing numbers, stamps, signatories) — mostly **new fields**.
- **Model-list reconciliation still open**: the defined 8 are CF/MF/OF/SF/SIB/PRS/FCB/FAB, but the
  samples include **HEADERS** (not in the 8) and have **no FCB/FAB** sample. Confirm with the client.

### Next / not yet built

- **The full combined folder PDF** — client-confirmed 2026-08-16: **one model per folder**, output as
  **one combined multi-page PDF** in filed order (not separate form downloads). One model per folder
  means the generator selects the form set + layout + entity by `projects.series`. Needs new stored
  fields for II(1)/XVII/III/III A (inspector, W.P., hydro date, drawing numbers, signatories, steel-
  making-process, heat-treatment) and generation of the covering-letter manifest + stage-wise report.
- Still deferred: xlsx **bulk TC import** (the `BomImport.jsx` two-phase pattern is the obvious
  fast-follow); linking parts to `bom_items`; TC revisions/approval workflow. See `QC-CHANGES.md`
  §5/§8 for older open questions.

## 5e. Sales department, Stores inventory, and In-Stock/SAS trading

V2-CHANGES.md Group 6 (the round's last group) — closes out D6–D9/D14, schema Phase 5.0 had left
dormant (`inventory_items`, `bom_items.source`, `sale_order_no`). Two new departments' worth of
surface, plus one real behavioral addition to the D4 procurement lifecycle: an item can now also
reach terminal status by being fulfilled from existing stock, not just procured.

- **Sales** (`/sales`, `components/SalesWorkspace.jsx`) — a real department (`lib/milestones.js`
  `DEPARTMENTS`), so it gets the generic Home/Operations/Projects shell for free and flows through
  the access matrix/d-login like every other head; owns no milestones (same precedent as
  Engineering/Stores). Maintains a simple **Sale Order** list (`sale_orders` table, D14 — free-text
  `so_no`, no entity upgrade yet) that Stores references when raising a trade request (§5e below).
- **Stores' inventory workbench** (`/stores`, `components/StoresWorkspace.jsx`) —
  `inventory_items` (D8: description, on-hand, location, reorder point). A low-stock badge reads off
  **`available`** (on-hand minus every active reservation, below), not raw on-hand, since that's the
  number Stores can actually still promise. **This is STERP's "Minimum Stock Level" — same concept,
  built earlier under the inventory-management name `reorder_point` rather than a second column.** A
  later audit (STERP.md) missed it — the check grepped for `reorder.?level`, not `reorder_point`, a
  research gap, not a product one; flagging here so it isn't "rediscovered" as missing a third time.
  **Below-minimum filter added 2026-08-18**: a `Button` toggle in the Inventory card header
  ("Below minimum only" / "Showing below minimum"), filtering the table to `isLowStock()` rows —
  previously there was only the count badge and per-row "Low" flag, no way to actually narrow the
  list. The existing "low stock" chip in `TodaySummary` now doubles as the filter's on-switch
  (`onShowLowStock`) instead of just jumping to a tab that was already the default — clicking it
  used to do nothing since Inventory is where you land regardless. Live-verified: 2 seeded items
  (5/10 and 50/10) — toggle and chip both correctly narrow to the one below its minimum.
- **Reserved/available inventory model (D6/D9)** — the client's own concern, raised directly while
  scoping this group: a naive "mark In-Stock → decrement on-hand" would let the same physical stock
  be promised to two different requests (a project BOM item and a trade order) at once. Fixed with a
  real two-step, not a single action: **Reserve** (`inventory_reservations` table) commits stock
  against one open request — reduces `available`, `on_hand` untouched — so no other request (any
  source) can draw the same units; **Issue** is the actual hand-out moment — `on_hand` decrements,
  the item's `purchase_status` becomes terminal **`In-Stock`** (D6). **Release** undoes an unissued
  reservation (also fired automatically on cancel, `lib/procurement.js`
  `releaseReservationsForItem`). Reserving less than requested **splits the `bom_items` row** —
  the reserved portion (a new cloned row) goes to Issue, the remainder keeps procuring on the
  original row — reusing the same per-project split pattern Group 5's PR flow already established,
  not new machinery.
- **Stock-building (D7)** — a `source='stock'` item runs the ordinary Enquiry→Received pipeline
  unchanged; reaching **Received** increments the inventory line it was raised against
  (`bom_items.inventory_item_id`/`inventory_qty`, captured numerically at request time — never
  parsed from the free-text `qty_text`). Guarded on the item's prior status so a re-save of an
  already-Received row never double-counts.
- **SAS/trade requests (D7/D14)** — Stores raises non-BOM requests from `/pr` (Group 5 Bundle A's
  unified PR flow) via a per-line **source** selector (`bom`/`stock`/`sas`, Stores-only,
  server-enforced): `sas` needs a Sale Order instead of a project. Since `bom_items.project_id`
  stays `NOT NULL` at the DB level (never actually relaxed, just deferred — confirmed by reading the
  schema before building), `stock`/`sas` items point at one seeded **sentinel system project**
  (`is_system=1`, `status='system'`) instead — invisible on every dashboard/rollup that already
  filters `status='active'`, but Procurement's own Enquiry/Selection/Status/PO tabs explicitly
  include it and render **`SO #<no>`** / **`Stock`** in place of the sentinel's placeholder name.
  From there a `sas`/`stock` item is an ordinary `bom_items` row — RFQ, Selection, PO, and Reserve
  all already handle it with no new procurement code, which is what lets a trade request compete for
  the same `available` stock pool as a project BOM item through the same Reserve action.
- **Four real bugs found and fixed while verifying, not just the happy path** — one pre-existing
  (unrelated to this round's own code, caught because this round's own routes happened to exercise
  it), three at the seam between the new reservation model and existing Group 5 routes it now has to
  coexist with:
  1. `nextCounterValue()` (`lib/db.js`) silently failed to persist for any counter never pre-seeded
     with a row (`pr_no`, added by Group 5 Bundle A, never was) — its `UPDATE ... WHERE name = ?`
     matched zero rows, so every call after the first recomputed the same value and collided on
     `purchase_requisitions.pr_no`'s UNIQUE constraint. Fixed at the root with an atomic `INSERT ...
     ON CONFLICT DO UPDATE ... RETURNING value` upsert.
  2. Manually cancelling a BOM item via the Status tab's dropdown (Procurement owns
     `purchase_status` outright) bypassed the reservation-release call that only lived in the
     dedicated `/cancel` route (Eng/Design only) — a manually-cancelled item's reservation stayed
     phantom-committed against `available` with no automatic cleanup. Fixed by adding the same
     transition-guarded release to the generic `PATCH /api/bom-items/[id]` route.
  3. Deleting a BOM item with any reservation history — active *or* released, both kept as history,
     same append-only precedent as `supplier_quotes` — 500'd on a raw Turso foreign-key constraint
     instead of a clean error (`inventory_reservations.bom_item_id` has no `ON DELETE` clause).
     Fixed with a block-not-cascade guard mirroring the existing `packing_items` check on the same
     route.
  4. `reserveFromStock()` never checked the target item wasn't already terminal (Received/Cancelled/
     In-Stock) — since `issueReservation()` unconditionally sets `purchase_status = 'In-Stock'`,
     reserving against an already-Received item and then issuing it would silently overwrite/
     resurrect a resolved item's real status. The same lesson Phase 5.1's `advancePurchaseStatus`
     already learned once for a different write path, hadn't carried over to this new one. Fixed
     with an `isClosedStatus` guard at the top of `reserveFromStock` (`lib/procurement.js`).
  All four confirmed live on the real dev DB and covered in `scripts/inventory-reservations-selfcheck.mjs`
  (8 cases), including the exclusivity case itself (a second request correctly blocked from drawing
  stock a first request had already reserved).

### As of 2026-08-17 — Stores/Sales integration round (working spec: `STORES-SALES-CHANGES.md`, now
### done and kept as the historical record, same precedent as `PROCUREMENT-CHANGES.md`/`QC-CHANGES.md`)

A investigation-first pass (traced the real code before deciding anything) found the actual gaps: no
automated BOM↔stock matching, SAS framed as Stores-initiated when the client's own model was
Sales-push, Sales unable to trigger a Project from its own Sale Order, Procurement's Enquiry queue
with zero stock-awareness, and near-zero cross-department notification coverage on any of it. All of
the following shipped against those specific findings, nothing speculative:

- **SAS is Sales-only now**, not Stores-initiated (a real reversal from Group 6's original design,
  §5e above — reflects a client decision made this round, not a bug in the original). Sales pushes a
  trade request against its own Sale Order (`components/SalesWorkspace.jsx`'s Request from Stores
  dialog) straight into `POST /api/purchase-requisitions`'s existing `source='sas'` materialization —
  same mechanism Stores used to use, just a different raiser. `PrWorkspace.jsx`'s Kind picker no
  longer offers Trade (SAS) to Stores at all; `SAS_RAISERS` is server-enforced to `{'Sales'}`.
- **Cross-department notifications**, wired at the actual event, not just logged: Sale Order created
  → Design + PM tier; SO converted to Project → Sales + PM tier (on top of the pre-existing Design +
  Engineering Scope-of-Supply notify); any new BOM (import, single add, or a PR line) → Stores;
  Procurement marking a line Received → Stores; Stores clicking Procure (below) → Procurement;
  releasing a reservation that leaves a Stores-Review line still gated → Stores again. `notifyPMs()`
  (`lib/notify.js`) is a narrow, deliberate exception to `notifyDepartment`'s by-design PM exclusion
  (PMs have no `departments` value specifically so per-milestone-handoff noise never reaches them) —
  used only for the two genuinely PM-relevant commercial events above.
- **Manual-mode Stores review gate** — the actual fix for "every new BOM line lands in Procurement's
  queue regardless of stock." New `bom_items.pending_review` column (plain boolean, deliberately NOT
  a new `purchase_status` enum value — that would have rippled into `derivePurchaseStage`/
  `BomStageBar`/`ProcurementFlow`'s 5-stage bar everywhere it's used). A fresh `bom`/`sas` line
  (PMB import when no historical status exists, a single BOM-item add, or the `bom`/`sas` branches of
  `purchase-requisitions`) inserts with `pending_review=1`; Stores' own Build stock requests skip it
  (self-raised, no second review needed). `getSourcingItems()` excludes `pending_review=1` rows
  entirely from Procurement's Enquiry query — genuinely invisible, not just unlabeled — until Stores
  clicks **Reserve** (fulfills from stock, never needs Procurement) or the new **Procure**
  (`POST /api/bom-items/[id]/procure`, clears the flag only, `purchase_status` untouched — it was
  already `'Enquiry'` from creation — and notifies Procurement). An **Auto/Manual toggle** exists in
  `StoresWorkspace.jsx` but Auto is a UI-only "coming soon" stub — Manual is the only real behavior
  regardless of which is selected, pending real item-level matching (see §3.2 below) being trustworthy
  enough to auto-commit stock against. **Note (2026-08-19):** a real automatic reservation mechanism
  does now exist, but it's a separate, narrower thing from what this toggle promises — §5k's
  geometry-based remnant matching, scoped to plate/section stock only, not this toggle's broader
  "any item" ambition. This Auto stub is unchanged and still not live.
- **Reserved-from-stock visibility on Procurement's own Enquiry queue** — `getSourcingItems()` now
  also returns `reserved_qty` (sum of active `inventory_reservations` per line); `ProcurementWorkspace.jsx`'s
  `EnquiryRow` shows a "Reserved from stock" badge when non-zero. Visibility only, not a status
  change — Reserve alone still never touches `purchase_status`, only Issue does.
- **Operations flow diagrams** for Sales (`components/SalesFlow.jsx`) and Stores
  (`components/StoresFlow.jsx`), same slot/pattern as Procurement's/Design's own. Stores' diagram has
  three source boxes (SAS/Trade from Sales, BOM Released from Design, Build Stock from Stores itself)
  feeding a `Requests → Stores Review → Reserved → In-Stock` spine, plus a `Received (via
  Procurement)` terminal that links out to Procurement's own pipeline instead of duplicating its
  5 stages. **Stores Outgoing/Incoming Incidents** added to Operations too — the exact same
  direction-split `TicketsPanel` pattern Procurement already had; no new notification plumbing
  needed, the Raise dialog's existing route (`POST /api/production/tasks`) already notifies.
- **Department-handling pills + split progress on the Projects list** (`app/projects/page.js`,
  `getProjectsWithStatus()` in `lib/data.js`) — "Design Progress" (always Design-specific: calc-sheet
  snapshot + drawing-approval counts, regardless of which department actually held the project) is
  gone, along with its backing `getDesignProgressByProject()`. Replaced with two well-defined,
  department-agnostic numbers built from the same milestone data the health badge already used:
  **Department Progress** (done/total of just the milestones owned by whichever department(s)
  `activeDepartments` says currently have the project) and **Overall Progress** (done/total of every
  milestone on the project). Both are plain milestone counts, no new concept invented.
- **§3.2 — the real Item Master catalog wiring, done.** Confirmed against the real client export
  (and the loaded data) that `items.item_code` is essentially unusable as a join key — only 1 of
  2,773 rows actually has one populated. The real key is `items.id` instead, and it's populated only
  when a line is genuinely picked from the catalog — no retroactive backfill of old free-text rows.
  New nullable `bom_items.item_id`/`inventory_items.item_id` (both `REFERENCES items(id)`).
  `PrWorkspace.jsx`'s pre-existing `ItemSearchField` (search UI already existed — Group 5's `/api/items`
  route — but never persisted a link) now sets `item_id` on pick and clears it on any hand-edit
  after; the same pattern was added fresh to Stores' New Item dialog
  (`components/StoresWorkspace.jsx`). The PMB import route best-effort auto-links on an exact
  (case/space-insensitive) `item_name` match against the catalog — a real signal since PMB exports
  and the Item Master both came from the same client ERP, not a guess. `possibleMatches()` (the
  Stores possible-match badge) now checks `item_id` equality first — a real, non-fuzzy match, shown
  with its own green ✓ badge distinct from the existing muted "≈" keyword-overlap one — falling back
  to keyword overlap only when no catalog link exists on either side.

### Price Lists + Agent Performance (2026-08-18, STERP Priority 1/2, no separate working-spec doc)

STERP-parity items "Price Lists" (schema item) and "Sales Agent Performance" (report item), built
together since the report's honest caveats and the price list's exact-match caveat are the same
kind of thing — real data where it exists, a labeled approximation where the underlying field
genuinely doesn't, never presented as equivalent.

- **`price_lists`** (new table, `lib/db.js`) — `customer_id` nullable (NULL = default rate open to
  every customer), `item_id NOT NULL REFERENCES items(id)` (a price list only makes sense against a
  real catalog item, same reasoning `supplier_quotes.bom_item_id` is `NOT NULL`), `rate`, `uom`,
  `valid_from`/`valid_until`. No `UNIQUE(customer_id, item_id)` — a renewed rate is a new row with
  its own validity window, same append-friendly shape as `supplier_quotes`. Unlike
  `supplier_quotes`, edit/delete **is** allowed (`app/api/price-lists/[id]/route.js`) — this is a
  published rate list, not a price-history log.
- **Sales → Price Lists**, a new tab (`components/SalesWorkspace.jsx`'s `PANELS`) — add/remove a
  rate, item picked from the same catalog search (`/api/items?search=`) Quotations now shares.
  `/api/items`'s department gate (`app/api/items/route.js`) widened from
  Engineering/Design/Stores to include Sales — a read gate (searching the catalog to price against
  it), not a write one.
- **`NewQuotationDialog` rate auto-fill** — the line-item description field is now a catalog
  search-as-you-type (`QuotationItemField`), same idiom as `PrWorkspace`/`StoresWorkspace`'s own
  each-file-local copies (three near-identical small typeaheads now, deliberately not
  force-unified — different line shapes each time). Picking an item calls
  `GET /api/price-lists?item_id=&customer_id=` (customer-specific row wins over the NULL/default
  row; most recent `valid_from` breaks a tie; expired rows excluded) and fills the rate — still a
  plain editable number afterward, never locked, with a small "Rate from the default/customer price
  list" hint. Re-runs on customer change so picking item-then-customer works the same as
  customer-then-item. Live-verified: a default-rate entry (₹3,200/Mtr) auto-filled correctly into a
  new quotation, total computed right through GST.
- **Reports → Agent Performance** (`components/CrmReportsWorkspace.jsx`, new Sales-group report) —
  groups leads/tasks by `assigned_to`, opportunities by `created_by` (see caveat below), client-side
  same as every other report on this page. Real per-agent numbers: leads assigned, conversion rate,
  follow-up completion. **Two labeled approximations, not silently equivalent to the rest**: Won
  value / lost reasons are attributed by whoever *created* the opportunity —
  `opportunities` has no per-agent owner column, only `created_by` and department-level
  `owner_dept`; and Average response time is the gap from `leads.created_at` to that lead's first
  `crm_notes` row (new `getLeadNotes()`, `lib/data.js`) — no first-contact timestamp exists
  anywhere. Both are marked with an asterisk in the table and spelled out in a footnote and the
  report's own description, not just in code comments. Live-verified against real seed data.
- **Help page**: Sales gained two new feature entries ("Price Lists," "Agent Performance") and the
  existing Quotations/Reports bullets were extended to mention the new behavior, following the
  existing Why/How/Work-through/Avoid/Done-when framework where warranted.

### Sales Enquiry, Returns, and Costing (2026-08-18) — and Sales Offices/Branches, deliberately skipped

Closes out STERP's Sales-owned remainder. Before building, checked what already existed rather
than re-deriving — this repo's own prior "Minimum Stock Level" miss (§5e above) made that check a
first step, not an afterthought this round.

- **Enquiry** — not a new entity. `leads.status='new'` already *is* the raw-enquiry bucket
  (`isSlaBreached` already special-cases it); `LeadsTab` gained an `initialStatus` prop and a new
  `PANELS` entry ("Enquiry," before "Leads") renders the exact same component pre-filtered to
  `new`. Zero new schema, zero new component.
- **Sales Offices and Branches — skipped, on purpose, by explicit decision.** No branch/office
  concept exists anywhere in the app; the only real multi-entity axis is `company` (Shanti Boilers
  / Shanti Techno Fab — a legal entity, already fully wired) and `leads.territory` is free text
  read by zero filters or reports. No confirmed multi-branch operation exists today, so this
  stayed unbuilt rather than inventing a speculative master-data entity — the YAGNI call, not an
  oversight. Revisit if a real multi-office need shows up.
- **Sales Returns** — new `sales_returns` table (`sale_order_id`, `item_description`, `qty`,
  `reason`, `inspection_outcome` pending/accepted/rejected, `stock_action` none/returned_to_stock/
  scrapped, `inventory_item_id`, `credit_note_ref`). New Sales → Returns tab: raise a return,
  inspect it, and — only once accepted — Restock (credits `inventory_items.on_hand`, reusing the
  exact `on_hand = on_hand + ?` idiom `app/api/bom-items/[id]/route.js`'s stock-build receipt
  already uses, guarded server-side to fire only on the transition into `returned_to_stock`) or
  Scrap. `credit_note_ref` is a plain reference string — no ledger posting, that's the client's
  separate Tally-integration doc, not this build. Live-verified: raised a return, accepted it,
  restocked against `inventory_items` — `on_hand` moved 5 → 8 for the 3-unit return.
- **Sales Costing** — post-sale only, real numbers, on the Sale Order once it has a linked Project.
  New `getProjectCosting(projectId)` (`lib/data.js`): material cost = `SUM(po_items.amount)` for
  *issued* POs only against that project (draft/cancelled aren't real spend, same convention
  Suppliers → Analysis already uses), labor cost = `SUM(job_card_time_logs.minutes/60 ×
  employees.cost_rate_per_hour)` joined through `job_cards.project_id`, margin = the Sale Order's
  `total` minus both. New `GET /api/projects/[id]/costing`; a "Costing" button/Sheet on the Sale
  Orders table, shown only when `so.project_id` exists — there's no honest cost data before that
  (Opportunities/Quotations never link to a Project pre-sale; `bom_items` carries no cost field at
  all, only `po_items` and job-card time logs do, and both require a real Project to exist first).
  **A pre-sale cost estimate on the Quotation was explicitly deferred, not built**: it would need
  someone to hand-enter a speculative cost, since no real data exists that early — flagged as a
  distinct future phase if it turns out to matter, not silently folded into this one. Live-verified:
  a Sale Order with a Project but no issued POs/logged labor yet correctly showed material cost —,
  labor cost —, margin = 100% of quoted value (nothing spent yet, honestly represented as zero, not
  hidden).
- **Help page**: three new Sales feature entries ("Enquiry," "Costing," "Returns"), standard
  Why/How/Work-through/Avoid/Done-when framework.

### As of 2026-08-19 — Stores' last three STERP items: Auto-Indent, GIR, Gate Pass

Closed STERP.md's remaining Stores backlog (Priority 1 item 9, Priority 2 items 14/15). Checked the
codebase against STERP's own labels first, not just trusted them — same discipline the "Minimum Stock
Level" miss above (this section, `reorder_point`) already forced once. Auto-Indent turned out to be a
genuine gap and the real next step past the existing below-minimum filter; GIR/Gate Pass turned out to
be genuinely new — no prior coverage under any name.

- **Auto-Indent Suggestions (STERP item 9)** — `getReorderSuggestions()` (`lib/data.js`), a **derived**
  list, no new table: every `inventory_items` row at or below its `reorder_point`
  (the same `isLowStock` condition the Inventory tab's badge/filter already reads), excluding any
  item that already has an open `source='stock'` `bom_items` line in flight — the same
  `NOT IN (Received,Cancelled,In-Stock)` guard `getOpenBomItems` uses — so a suggestion doesn't keep
  re-appearing after Stores has already acted on it. New "Reorder Suggestions" tab in
  `StoresWorkspace.jsx`: suggested qty is `reorder_point - available`, editable, and **Create
  request** posts to the existing `POST /api/purchase-requisitions` with `source='stock'` — the exact
  same Build-stock path the Inventory tab's own stock-request flow already used. No new route, no new
  action key, nothing auto-created — human approval is the click itself.
- **Formal GIR / Gate Inward Receipt (STERP item 14)** — new `gate_inward_receipts` table (`lib/db.js`):
  vehicle, supplier, driver, entry time, a free-text material reference, two security checkboxes
  (seal/docs) + remarks, and a `grn_ref`/`status` pair for closing it out once receipt is confirmed.
  `gir_no` via `nextCounterValue('gir_no')`. New action key `stores.gir.write`. Routes:
  `app/api/gate-inward-receipts/route.js` (list/create), `[id]/route.js` (attach GRN ref / close).
  Standalone gate/security-desk log — deliberately outside the reserve/available inventory model;
  creating or closing a GIR never touches `on_hand`.
- **Returnable / Non-Returnable Gate Pass (STERP item 15)** — new `gate_passes` + `gate_pass_items`
  tables: type, party, responsible person, purpose, expected return date (returnable only), and a
  status machine (`draft → approved → issued → returned/cancelled`). Approval is its own action key
  (`stores.gatepass.approve`), separate from `stores.gatepass.write` (create/issue/item-return-tick) —
  STERP calls out approval as a distinct step, so it's a distinct authority, not folded into write.
  **Overdue is derived, not stored**: returnable + not returned/cancelled + past `expected_return_date`,
  computed in `getGatePasses()`'s SELECT — same reasoning as `available` on `inventory_items`, a stored
  flag would drift the moment "today" moves. Per-item returned ticks auto-flip the pass to `returned`
  the moment every line is ticked (and back to `issued` if one gets un-ticked), so there's no separate
  "mark whole pass returned" action to forget.
- **Live-verified end to end** (`stores_head`, dev server): reorder suggestion → Create request →
  appeared in Open Requests as an ordinary `source='stock'` Enquiry line, suggestion list emptied
  itself, dedup confirmed on reload. GIR created with both security checks → listed correctly → closed.
  Returnable gate pass created with a past return date → Overdue badge shown on Draft → Approve →
  Issue → item return-tick → pass auto-flipped to Returned, Overdue cleared. Non-returnable pass
  created separately → confirmed no return-date field, no overdue logic, "—" shown for Return by.
  One environment wrinkle hit during verification, not a code bug: a `403 Forbidden` mid-flow traced to
  the session being swapped out from under the tab — this repo's dev server points at the shared
  Turso DB (see the dev-server/Turso memory note), and concurrent activity on it can invalidate a
  logged-in session; re-authenticating as `stores_head` and retrying the same click succeeded (`200`).
- **Docs**: three new Stores feature entries in `department-help-content.jsx` ("Reorder suggestions,"
  "Gate Inward Receipts (GIR)," "Gate Passes"); STERP.md items 9/14/15 marked BUILT with this
  subsection as the reference.

### Follow-up (same day, 2026-08-19) — gaps found on review, demo data, help-page `howTo`

A second pass, prompted by direct product review rather than a new build:

- **Reserve was the visually secondary button, Procure the primary one** (`OpenRequestsCard`,
  `StoresWorkspace.jsx`) — backwards from the actual intent (don't procure what's already in stock).
  Swapped: Reserve is now the solid/primary action, Procure outline/secondary.
- **Two real server-side gaps**, both UI-only guards with no route-level enforcement:
  1. Gate Pass's per-item returned-tick (`PATCH /api/gate-passes/[id]`) never checked the parent
     pass's status — callable directly (bypassing the buttons the UI actually shows) to tick an item
     returned on a `draft`/`cancelled`/`approved` pass. Fixed with a `409` guard, `issued`/`returned`
     only. Verified via a direct `fetch()` call, not just the UI.
  2. GIR's `close` action had no precondition at all — a GIR could close with no `grn_ref`, breaking
     the "closed means actually received" invariant the route's own header comment claimed. Fixed:
     `close` now 400s without a `grn_ref` (existing or in the same call), and repeat-close is blocked.
     UI grew an inline GRN-ref input on each open row, Close disabled (with a tooltip) until one
     exists.
  3. GIR creation had no required fields at all (a fully blank GIR was allowed) — now requires at
     least a vehicle number or a supplier.
- **Demo data** — `scripts/seed-stores-gate-demo.mjs` (new), scoped to `gate_inward_receipts`/
  `gate_passes`/`gate_pass_items` only, re-runnable (wipes its own scope first). Seeds 2 GIRs and 6
  Gate Passes covering every status the UI exercises, including one genuinely overdue row. Reorder
  Suggestions needed no seed — the pre-existing MS Angle 50x50x5 row (8/10) already triggers it.
  `4.5-DATA-INVENTORY.md` updated to match (new dated section + classification-table rows).
- **`howTo` was never updated** — the three new features only ever got `features` entries; Stores'
  flat `howTo` list (5 generic steps) said nothing about any of them, next to Production's much
  denser `howToGroups`. Added 4 new `howTo` entries: acting on a reorder suggestion, logging a GIR,
  closing a GIR, and the full Gate Pass issue→return lifecycle.
- **§7 ER diagram** (this file) was missing `inventory_items`/`inventory_reservations` entirely (a
  pre-existing gap, not introduced this round) alongside the three new tables — all four lines added.

### 2026-08-20 — Stores Allocation & Procurement Workflow redesign (Auto/Manual made real)

Audited before writing anything (per the working spec's own instruction): the reservation core
(`reserveFromStock`), the partial-match-split mechanic (`splitQtyText`/`cloneBomItemForSplit`), and
dimensional auto-matching (`lib/remnant-match.js`'s `matchAndReserve`/`matchProjectBom`, wired into
BOM release and single-item add) already did everything the redesign asked for — for plate/section
stock only. The `pending_review` gate and `getSourcingItems`'s `reserved_qty` badge already existed
too. What was actually missing: (1) no automatic path for **plain** (non-dimensional) inventory —
`reserveFromStock` was reachable only via Stores' manual Reserve click; (2) SAS lines got no
auto-matching of any kind; (3) the Manual/Auto toggle (`ReservationModeToggle`) was a dead
client-only `useState`, not a real setting. No new procurement lifecycle, no new demand table, no
duplicate reservation system — this was entirely new write-path wiring around the existing one.

- **`app_settings`** (`lib/db.js`) — one global key/value row, not a settings subsystem. Backs
  `getAllocationMode()`/`setAllocationMode()` (`lib/procurement.js`), default `'auto'`. New route
  `GET/PATCH /api/settings/allocation-mode` (GET is `isInternal`, PATCH is Stores-gated,
  `stores.allocation_mode.write`).
- **`autoReserveFromStock(bomItem, username)`** (`lib/procurement.js`) — the plain-quantity sibling
  of `matchAndReserve`, reusing the exact same shared helpers (`reserveFromStock`,
  `splitQtyText`/`cloneBomItemForSplit`). Only ever matches on an **exact catalog identity**
  (`bom_item.item_id === inventory_items.item_id`) — the same real, non-fuzzy signal
  `possibleMatches()`'s green "✓" badge already trusts client-side; never the fuzzy keyword-overlap
  fallback (already rejected once for this exact reason, STORES-SALES-CHANGES.md §3.1). Full match:
  no clone, so the bom_item itself is force-gated `pending_review=1` (mirrors `matchAndReserve`'s
  full-match branch exactly). Partial match: the reserved clone gets the same gate; the original row
  (now carrying just the shortfall) is left alone — already `pending_review=0` from the insert, so
  it's immediately visible to Procurement, no Stores click needed. `matchProjectPlainStock(projectId,
  username)` is release-bom's whole-project sweep, the plain-stock counterpart to `matchProjectBom`.
- **Insert-time `pending_review` now respects the mode**, at every line-creation point: PMB import
  (`app/api/projects/[id]/bom/import/route.js`, fresh rows only — historical-status rows are
  unaffected, unchanged), single-item add (`app/api/bom-items/route.js`), and the PR route's
  `'bom'`/`'sas'` branches (`app/api/purchase-requisitions/route.js` — `'stock'` was already
  ungated, unchanged). Manual mode: always `1`, the original always-review behavior, byte-for-byte.
  Auto mode: always `0` at insert, then `matchAndReserve` (dimensional) followed by
  `autoReserveFromStock` (plain) decide whether anything actually needs re-gating. This is also why
  SAS lines now auto-match — same call, right after insert, same as the BOM paths.
  `release-bom`'s POST also now runs `matchProjectPlainStock` right alongside its existing
  `matchProjectBom` call.
- **Stores UI** — `OpenRequestsCard` treats a plain auto-reservation (`reserved_qty > 0`, new column
  on `getOpenBomItems`, same subquery shape `getSourcingItems` already used) exactly like a remnant
  match: an "Auto-reserved" badge, no Reserve/Procure buttons — it's already resolved, nothing to
  do. `ReservationModeToggle` now fetches/persists the real mode instead of a dead local toggle;
  relabeled "Automatic" / "Stores Review / Manual" to match the working spec's own wording, with an
  inline explanation of what each mode actually does.
- **Procurement UI** — `EnquiryRow`'s existing "Reserved from stock" badge was informational only;
  relabeled to spell out the actual numbers ("Partial stock — N reserved, this line is the
  shortfall") per the working spec's "don't rely only on disabled buttons, explain the reason"
  principle. No functional gating needed adding — Procurement already can't over-source a partial
  line because `reserveFromStock`'s split already shrinks `qty_text` down to just the shortfall, and
  a full match's `pending_review=1` already removes the line from `getSourcingItems()` entirely, so
  "Procurement cannot buy already-fulfilled stock" was already structurally true, not something this
  round had to add.
- **Notifications** — the one new one: `notifyProcurementIfShortfall(bomItemId)`
  (`lib/procurement.js`), fired only in Auto mode (Manual mode's existing Procure-click notification
  is unchanged and unaffected), `dedupe_key: auto_shortage:<id>` so a line already notified never
  re-fires on a later release/edit. This closes a real gap Auto mode would otherwise have left open:
  Procurement previously only ever heard about new demand via Stores' explicit Procure click, which
  Auto mode never makes. No new notification for a *fully* auto-reserved line — the working spec's
  own instruction ("do not spam Stores every time AUTO successfully reserves a normal item") applies
  symmetrically to Procurement: nothing to act on, nothing to notify about.
- **Help page**: the old "Manual review (Stores Review / Procure)" feature became "Allocation Mode
  (Automatic / Stores Review)", carrying the working spec's own ASCII diagram (new `diagram` field
  + `<pre>` rendering added to `DepartmentHelpWorkspace.jsx`'s `GuideBody`, since no prior feature
  needed monospace rendering) and an explanation of both modes. `sas` feature and one `howTo` entry
  updated to match. STERP.md item 9 (Auto-Indent Suggestions, already BUILT 2026-08-19) is a
  distinct, unrelated feature — reorder suggestions for restocking depleted inventory — not
  superseded or duplicated by this allocation-mode work.

### Known gaps in Stores (2026-08-20, not built — raised in review, tracked here rather than silently deferred)

Found while reviewing GIR/Gate Pass (§5e's 2026-08-19 entry above) and the Allocation Mode redesign
(2026-08-20 entry above) against real usage. None of these block the current feature set; all are
real, scoped follow-ups, not oversights being hidden:

1. **No printable Gate Pass slip.** Every other outbound document in this app (PO, Quotation) gets a
   PDF; a Gate Pass is physically handed to a security guard and today only exists as a screen.
2. **No edit route on GIR or Gate Pass beyond status transitions.** `PATCH /api/gate-passes/[id]`
   and `PATCH /api/gate-inward-receipts/[id]` only ever move status (approve/issue/cancel/close) or
   tick an item returned — a mistyped vehicle number, driver name, or party has no fix path short of
   cancelling and re-raising.
3. **An overdue Gate Pass fires no notification.** It's a derived badge (`getGatePasses()`'s
   `is_overdue`) you only see by opening the tab — unlike Stores Review or a released reservation,
   which both notify. Same "meaningful cross-department event" bar the rest of §5e's notifications
   already clear; this one doesn't yet.
4. **No search/filter on GIR or Gate Pass tables.** Inventory has "Below minimum only"; these two
   have nothing once they grow past a screenful.
5. **GIR and Procurement's own Received status are unlinked.** `gate_inward_receipts.grn_ref` and
   `bom_items.grn_ref` are both free text with no FK or cross-check between them — nothing forces a
   closed GIR and a Received BOM line describing the same physical delivery to actually agree.

(Purchase Returns — originally flagged alongside these — is no longer a gap; see §5o, built
independently as a Procurement-side feature.)

### 2026-08-21 — SO→Project conversion: reachability fix for Design head

The "Convert to Project" button (above, STORES-SALES-CHANGES.md §2b/§4) lived only on `/sales`,
which is gated on `canAccessDepartment(user, 'Sales'/'Marketing')`. The button's own client gate and
the `POST /api/projects` server gate were both `isDesignHead` (PM or Design head) — but a
**Design-only** head, the common case, has neither Sales nor Marketing access and was silently
redirected off `/sales` before ever seeing the button. Confirmed live: `design_head` (Design-only in
the demo access matrix) hit `/sales` and was bounced to their home page.

Fixed by adding a second entry point where a Design head actually lands: **`ConvertSaleOrderButton.jsx`**,
next to "+ New Project" on `/projects` (`app/projects/page.js`). Same `POST /api/projects` +
`sale_order_id` call as before — not a new flow, a second door to the existing one. The picker only
lists Sale Orders with `item_count > 0` (a new additive column on `getSaleOrders()`, `lib/data.js`)
— the real "ready for a Project" signal, since only a Quotation→convert SO ever gets real line
items; the quick-add "New Sale Order" dialog never did. No new Sales-side button/status was added
for this — checked first and the Quotation-convert flow already notifies Design+PMs at the right
moment (see the "SO converted to Project" notification above).

The old Sales-side `ConvertToProjectDialog` (`SalesWorkspace.jsx`) was then **removed** as
redundant — `canCreateProject` prop plumbing deleted from `SalesWorkspace.jsx`/`app/sales/page.js`
too. Live-verified both ways: `design_head` converts a real Sale Order to a Project entirely from
`/projects` (produced project **SB-1039**, Scope of Supply auto-populated, correct
`sos_created`/`project_created` notifications fired); `admin`'s `/sales` Sale Orders tab now shows
only Costing + Request-from-Stores per row, no Convert button, nothing else broken.

## 5f. Calc Sheets — engineering calculation engine

`/calc` (`components/CalcWorkspace.jsx`), gated to Design/Engineering jointly (`requireCalcAccess`,
`lib/calc.js` — checks either department; PMs pass unconditionally), same cross-department
top-level-tab mechanism as `/stores`, `/qc`, `/sales`. A persistent, Turso-backed calculation tool
that took an isolated React prototype to an engineering-grade platform over three phases plus a
follow-on round. Build history was in `CALC-CHANGES.md` (folded here 2026-08-11); the module's own
fast test is `scripts/calc-engine-selfcheck.mjs`.

**The pure/server split — this is what makes it trustworthy.** The computation core
(`lib/calc-engine.js` — `computeAll`, `runValidations`, `runFormulaTests`, `goalSeek`,
`sensitivityAnalysis`, `changeImpact`, the `LIBRARY`) is pure: no DB, no Next-server imports, so it
imports into both the `'use client'` workspace (instant live recompute while editing) and the server
(`lib/calc.js`, the Turso data layer, on snapshot save). The identical code path both places is what
makes "Reproduce" in the Audit panel — replaying a frozen snapshot and getting the same numbers —
actually mean something. `scripts/calc-engine-selfcheck.mjs` hand-mirrors `lib/calc-engine.js`
byte-for-byte (Next's extensionless-import convention doesn't resolve in plain Node); **keep the two
in sync whenever the engine changes** — it's the iteration loop, run it before the browser.

**Phase 1 — trust the numbers.** (1) **Units:** every physical-unit variable is wrapped as a mathjs
`Unit` before evaluation and converted back to the formula's declared output unit after — mixed-unit
inputs (42 bar against an MPa allowable stress) convert automatically, a genuine dimension mismatch
throws instead of silently computing. (2) **Iteration/convergence:** the formula dependency graph
runs through Tarjan's SCC detection; acyclic formulas run once in dependency order, a real
circular-dependency group iterates Gauss-Seidel until every formula's relative change drops below its
own `iteration_tolerance` (or `iteration_max` hits, reported `converged: false` honestly). (3)
**Lookup tables:** `LOOKUP("table", x, "column")` in a formula does 1D linear interpolation,
extrapolates past the range with a warning rather than clamping. (4) **Regression tests:** a
formula's worked examples (`calc_formula_tests`) run live in Methodology and as a save-time gate —
`setFormulaStatus` blocks Draft→Pending while any test fails, one implementation both places.

**Phase 2 — real engineering complexity.** (2.1) **Multi-domain chain:** a seeded thermal
(flue-gas) domain — `GasVelocity` ⟷ `HeatTransferCoefficient`, a genuine 2-way cycle — feeds a
`ThermalCorrosionAllowance` into the mechanical (shell-thickness) domain via the *validation* layer,
not by editing the approved formula body (which would force a version bump on every seed boot); also
the first live demo of 1.2's convergence engine. (2.2) **Goal-seek:** bisection on a chosen input
against a target output, `computeAll` as the black-box. (2.3) **Sensitivity:** sweep one input ±% and
chart the response (inline SVG, no chart dep). (2.4) **Conditional execution:** an optional boolean
`guard_expr` per formula version; a false guard skips the formula (keeps its prior value) instead of
computing.

**Phase 3 — professional work product.** (3.1) **PDF report** (`lib/calc-report-pdf.js`, same
`@react-pdf/renderer` shape as `po-pdf.js`/`quotation-pdf.js`): a "Calculation Sheet" from a
snapshot's frozen data — inputs, full execution trace, validations, and a deduplicated References
section. (3.2) **Change impact analysis:** before approving a new formula version, `changeImpact`
recomputes every past snapshot that pinned it and reports which outputs move and which validations
flip — pure, runs client-side. (3.3) **Excel bridge** (`xlsx`, already a dep): export the live
methodology to a 4-sheet workbook (`lib/calc-export.js`); import updates existing non-computed
variable values by name via a two-phase preview/confirm (`lib/calc-import.mjs`, same shape as the
masters import) — scoped down from a full column-mapping wizard on purpose.

**Follow-on items (12–16).** Design margin as a named `DesignMarginPct` constant (not a hardcoded
0.15 inside a validation); engineering notes (`calc_notes`, append-only, on any variable or formula);
array/list variables (a new `array` variable type with `SUM("arr","col")`/`COUNT("arr")` aggregate
functions — scoped to aggregates, not per-row formulas); a structured standard/clause/**edition**
tracker (`source_edition` column, indexed in the PDF's References section); calculation templates
(`calc_templates` — save/apply a named preset of inputs, seeded "Fire Tube Boiler — Standard"). A
dropdown-UX pass converted free-text unit / x-column / test-input fields to Selects where the option
set is knowable.

**Design responsibility and access hierarchy (decision 2026-08-15).** HR remains the people master;
Settings grants application access only to existing HR employees. Executives and managers grant or
revoke the Design Head's system access. A Design Head grants or revokes Designer access for active
HR employees in the Design department from their own Settings view. Admin has an unrestricted
override for all departments and responsibilities. A Design Head cannot create another Design Head,
change another department, or approve their own submission. These are separate from the HR
designation label: `Design Head`/`Designer` may describe the employee, but the system responsibility
assignment is the permission source.

The Design workflow is therefore `Designer work → Under review → Design Head approval → Released`.
The current enforcement is status-based: only a Design Head can select `approved`/`as_built`, assign
Design teammates, set due dates, delete drawings, or delete drawing files; Designers can upload files,
edit working notes, and move work through `not_started`/`in_progress`/`under_review`. Formula approval
is also Design-Head-only. Approval actions, assignments, due dates, access changes, and employee
deactivation are audited. Version-specific approval records, rejection reasons/resubmission requests,
and a dedicated approval queue/notification workflow remain the next approval-hardening increment;
they are not represented as completed features in this release. Design Heads and Designers are
eligible only while their linked HR employee is active and assigned to Design.

The Settings account-creation form requires an active, unlinked HR employee and writes the new
user's `employees.user_id` link in the same workflow. A Design Head's Settings page can grant or
revoke only Designer access for active linked Design employees; it cannot create accounts or assign
another head. Calc users may delete a calculation sheet, but the API preserves the last sheet in a
project and there is no employee project-delete operation.

**Current-user HR integration (implemented 2026-08-15).** The database migration also runs an
idempotent `backfillSystemUsersIntoHr` pass for existing internal accounts (`admin`, `manager`,
`executive`, and `operator`) that do not yet have an `employees.user_id` link. It creates one active
or inactive `staff` HR row using the account name and first department, without overwriting an
existing employee or guessing a missing department. New admin/manager/executive account creation
therefore follows the same HR-first rule as operator creation. HR remains the authoritative place
to correct employee name, department, designation, active status, and reporting line.

**Authority map for Design and Engineering (implemented 2026-08-15).** `admin`, `manager`, and
`executive` may assign or change Head responsibility for either department. A Design Head may grant
or revoke Designer access only for active, HR-linked Design employees and cannot grant another Head
or manage unrelated departments. The same responsibility model is available for Engineering; the
HR employee record mirrors cross-department system access in `employees.access_departments`, while
`employees.department` remains the primary HR department. Design Head owns technical approval of
calculations and drawings; Designers submit work by moving it to `under_review`. No employee can
approve their own work. Access-changing and approval actions are audited, and sensitive mutations
re-check the current HR link so deactivation takes effect immediately.

The one-time responsibility migration preserves the demo `design_head` as Design Head and, when
those accounts exist, configures `jaganmohan` as Design + Engineering Head and `ravi`/`vijay` as
Design + Engineering Designers. The migration records a marker and will not overwrite later admin
changes. Admins can change all of these assignments from Settings → Access Management; the linked
HR rows update their system department-access mirror at the same time.

**Not modeled at all — needs real Shanti data first.** The seeded material tables (SA-516 allowable
stress), the thermal correlation constants, and the nozzle-schedule areas are all *illustrative*
demo data, deliberately not certified values — real material-property tables, design-basis
translation, and BOM/drawing generation wait for actual Shanti calculation sheets and QA/material-cert
data (this is what the "needs real Shanti data" comments in `lib/db.js`'s calc seed point at).

**Schema** (`lib/db.js` `migrate`/`seedCalcDemoData`): `calc_variables` (incl. `array_json` for array
vars, now per-sheet — see §A below), `calc_formulas` (+ `iteration_*`, `source_edition`) /
`calc_formula_versions` (+ `guard_expr`) / `calc_formula_tests`, `calc_validations`, `calc_snapshots`
(per-sheet), `calc_tables`/`calc_table_rows`, `calc_notes` (per-sheet for variable notes, sheet-less
for formula notes), `calc_templates`, `calc_sheets`, `calc_drawings`/`calc_drawing_files`. API routes
under `app/api/calc-*`, all gated by `requireCalcAccess`, audited via `lib/usb.js`.

**Round 2 (`CALC-CHANGES2.md`, folded in here 2026-08-11) — real project hierarchy + Drawings.**

- **§A Project hierarchy:** `Company → Project → Calc Sheet → Snapshot`. New `calc_sheets`
  (`project_id` FK → `projects.id`). `calc_variables` (Registry — where a variable's live value
  actually lives), `calc_snapshots`, and variable-entity `calc_notes` are now scoped by
  `calc_sheet_id` — Registry's global `UNIQUE(name)` became `UNIQUE(calc_sheet_id, name)` via a
  one-time guarded table rebuild (`migrateCalcProjectHierarchy` in `lib/db.js`, ids preserved).
  Methodology (`calc_formulas`/`calc_formula_versions`/`calc_formula_tests`), Tables
  (`calc_tables`/`calc_table_rows`), `calc_validations`, and `calc_templates` stay fully global —
  unchanged, referenced by name from any sheet. Because `computeAll` always runs the *full* global
  formula set for whichever sheet is open, every sheet needs its own computed-variable row per
  global formula for dependency resolution to work — `addFormula` backfills one onto every existing
  `calc_sheets` row when a new formula is created, and `createCalcSheet` clones the seed
  input/constant/array set (+ one computed row per formula) from an existing sheet when a new one is
  made. Routing: `/calc` → project picker → `/calc/project/[projectId]` → sheet selector/tabs →
  `/calc/project/[projectId]/[sheetId]` → the workspace. Sidebar relabeled "Project" → **Calculation**;
  Registry stays alongside it (per-sheet data); Methodology/Library/Tables grouped under an
  **Engineering** heading for tidiness only (still global); Audit under **Governance**.
- **§B/§C Drawings:** new `calc_drawings` (project-scoped, not sheet-scoped — one GA Drawing per
  boiler) + `calc_drawing_files` (Cloudflare R2 via `lib/r2.js`, same best-effort try/catch pattern
  as `test_certificates.pdf_key` — an unconfigured bucket in dev 502s the upload/delete route without
  touching the DB row). New sidebar panel with a 6-segment inline-SVG progress bar (green = approved/
  as_built, yellow = in_progress/under_review, gray = not_started).

  Sheet-level diagnostics remain in the Calculation → Analysis view: validation donut, margin gauge,
  history-gated input radar, goal-seek, sensitivity response chart, and an execution trace. Analysis
  presents visual diagnostics first, then the two what-if tools; the execution trace is collapsed by
  default because it is an on-demand engineering audit rather than the first-read summary. The Calc → Portfolio
  view is intentionally a cross-project status table (design progress, bottleneck, calculation
  status, and drawings), not an engineering chart dashboard; aggregate portfolio charts remain
  deferred until there is a defined management question and trusted cross-project metric model.
  Routes under `app/api/calc-drawings/*`.
- **§D Projects tab:** `/projects` gets a read-only **Design Progress** column
  (`getDesignProgressByProject`, cheap SQL proxy — a sheet counts "done" once it has any snapshot, a
  drawing once approved/as_built — not a full validations replay across every project). The project
  page's Design department panel (previously just the bare milestone list, `DesignPanel.jsx` via
  `DepartmentPanel.jsx`) now also gets Calculation Sheets (pass/warn/fail replayed from each sheet's
  latest snapshot against live validations, `getProjectDesignSummary`), the same Drawings checklist,
  a 5-item merge-sorted Activity feed, and a placeholder Work Orders/SOS table (3 columns, no real
  schema — awaiting Shanti's actual WO/SOS format, and not to be confused with Sales' `sale_orders`).
- **§E Operations tab:** `DesignFlow.jsx` (Concept → Calculation → Review → Approved → Released),
  mirrored off `ProcurementFlow.jsx`'s node/spine shapes but without its cancellation branching (Design
  has no cancelled/terminal-exit concept). `getDesignFlowCounts()` derives each active project's stage
  from calc_sheets/snapshots/drawings status alone — no new enum; since Methodology is global,
  "all formulas approved" is one project-independent flag, not a per-project engine recompute.
  `DesignMasterTable.jsx` (Project | Customer | Design Progress | Bottleneck | Calc Status | Drawings)
  reuses `TodayBand`'s exact `['overdue','blocked']` partition for Bottleneck. Incidents split into
  Outgoing/Incoming `TicketsPanel`s, same pattern as Procurement's.
- **§F Requests tab:** the *live* Requests mechanism is `/pr` (`PrWorkspace.jsx`,
  `purchase_requisitions`/`pr_items`) — the older single-item `procurement_requests` table is already
  retired (Nav.jsx). `pr_items`/`bom_items` gained `category` (`plate`/`ms_section`/`angle`/`standard`,
  'bom'-source lines only) + `category_fields_json` (shape varies by category, same idiom as
  `calc_tables`) + `origin` (`manual`|`bom`, the latter reserved for a future auto-BOM generator, not
  built this round). **`heat_number` deliberately not added** — Procurement-vs-Stores ownership is
  unresolved against `BOM_FIELD_OWNERS`' existing pattern (every other receipt-time field is Stores'),
  deferred rather than force-picked. Belt number confirmed out of scope, not built. Job Cards were
  out of scope *for this Requests-tab round* — they exist now, as their own module, see §5g.

## 5g. Production — Job Cards, milestone-scoped shop-floor execution

Full history/decisions in `PRODUCTION-MODULE-DESIGN.md`, kept as the record — this section is the
as-built result. Production's own nav tab is renamed **`Job Card`** (was `Workers`); the board is
the default landing view. The now-redundant `Tasks` tab (`/production` — identical content to
`Home`) is dropped from `Nav.jsx`. See §3a for the people-side change (roster unification) this
module depends on.

- **Job Cards are milestone-scoped, not free-text.** `job_cards.milestone_id` is the primary link —
  `project_id`/`section` are derived server-side from the real milestone
  (`lib/milestones.js` MILESTONE_TEMPLATE, e.g. "Shell Welding", "Box Up Welding (OS / IS / G)"),
  never taken from the client, so a card can't drift out of sync with the milestone it's meant to
  roll up into. `operation_id` (from a small `operations` master) and `workstation_id` (`workstations`
  master, carries `machine_hour_rate`) are both optional — most milestones are already one specific
  action; operation is a finer tag only for the few that bundle several verbs. `bom_item_id` stays
  optional for the cases that map to one BOM line. `status` (pending/progress/done), `is_paused`,
  `is_outside`+`outside_vendor` (subcontracted, a flag not a module), `is_site` (Site Marking /
  Welding FURA-B/RC/AR happen at the customer's site, not the shop — same flag precedent), and
  `qty_planned`/`qty_done`/`qty_rejected` round out the row.
- **Time logs, not one hours field.** `job_card_time_logs` — one row per work session, `employee_id`
  + `minutes` (+ optional `from_time`/`to_time`, real clock times; the UI computes minutes from
  them when given, direct minutes entry is the fallback) + `qty_completed`. Labor cost = Σ
  `minutes`/60 × `employees.cost_rate_per_hour` (HR-owned rate, Production-consumed, same
  ownership split as §2.5) — computed at today's rate, not frozen historically; shown per-log and
  as a card total, explicitly labelled "labor only" since `job_card_consumables` (welding
  rods/gas/discs, free text, no Item master, no stock ledger) carry no price.
- **Rework loop.** `job_cards.rework_of_job_card_id` / `qc_record_id` carry lineage. A card's own
  "Create rework card" button spawns a linked pending card against the same milestone; a failed
  Hydro Test record (see below) has the same button built in, pre-filled.
- **BOM tab** (new, cross-project) — a project picker, then the existing `BomTable`/`getProjectBom`
  (§5a) field-scoped to Production's real ownership (`issued_ref`/`received_ref`, straight from
  `BOM_FIELD_OWNERS.Production` — no separate UI-level list to drift from the server-enforced one).
  Alongside it: **fabrication-% progress bars per milestone** (`getFabricationProgress`, job-card
  completion, correct by construction now that cards are milestone-scoped) and an **issue-material**
  mini-form/list against `material_issues` (`bom_item_id`, optional `job_card_id`, `qty`) —
  structured Stores→WIP consumption, replacing free text going forward without touching existing
  `issued_ref`/`received_ref` data. Stores **or** Production can issue (mirrors the authority
  Production already had over those BOM columns). **Cutting & remnant (2026-08-19, §5k):** a
  separate list, scoped to dimensional (plate/section) lines only, each with a **Cut** action —
  pre-filled with the auto-matched remnant when one exists.
- **Masters:** `operations`, `workstations`, `trades` (§3a) — all three get a small `+` popover
  (`components/QuickAddInline.jsx`) next to their pickers, so a new workstation doesn't need direct
  API access to add.
- **Hydro Test — ownership transferred from QC to Production, not shared.** `qc_records` splits by
  `test_type`: a hydro-test record (`POST`/`PATCH`/`DELETE /api/qc-records`) is Production's alone
  now; every other type (radiography/NDE, MTC, freeform) stays QC-exclusive, same table, no new
  column. The milestone (`hydro_test`, `lib/milestones.js`) moved department too — `department` is
  copied onto each `milestones` row at project-creation time, not derived live, so a migration
  updates already-seeded projects' rows, not just the template. The record UI (`QcPanel`, `title`/
  `defaultTestType`/`reworkMilestoneId` props) now also renders on the project page's **Production**
  tab, filtered to hydro rows, locked to that test type; QC's own tab excludes hydro rows so it
  never shows edit controls that would now 403.

## 5h. Milestone automation, structured Scope of Supply, and Requests/Templates (2026-08-17, no separate working-spec doc — folded straight in here)

- **Stores gets a sidebar workspace** (`components/StoresWorkspace.jsx`), same `WorkspaceSidebar`
  pattern as Production's Job Card panel: Inventory / Open Requests / Active Reservations /
  Material Issued to WIP as real tabs instead of one long scrolling page. The today-summary chips
  and Manual/Auto toggle live on the Inventory (default) tab; the chips now switch tabs instead of
  anchor-jumping to a div id that isn't mounted on other tabs.
- **Projects list and project-detail page both show "who has it, doing what."**
  `lib/data.js`'s `activeDepartmentStatus(ms)` (shared by `getProjectsWithStatus()` and the
  project-detail page, scoped to that one project's milestones) returns `departmentProgress`:
  `{department, done, total, activeMilestones}` per department currently holding the ball —
  `activeMilestones` is the specific in-progress (or next-up) milestone label(s), so a pill reads
  "Production · Welding (FURA-B / RC / AR)", not just "Production". Shared render components
  `components/DepartmentStatus.jsx` (`DepartmentPills`/`DepartmentProgress`) back both the Projects
  list table/cards and the project-detail page's Row 2 slot 3 ("Currently With" card), which
  replaced the old Design-chip-or-BOM-rollup guess entirely — deleted `getBomRollup`,
  `getProjectDesignStage`, `components/BomProgress.jsx` as dead code once nothing read them.
- **Cross-department BOM visibility gates** — three, each wired at the actual write path, not a
  polling check: Procurement's Enquiry queue (`getSourcingItems()`) now also requires the
  project's `release_bom` milestone to be `done` (a normal `source='bom'` line only reaches
  Procurement once Design has actually finished releasing it; stock/sas sentinel lines are exempt,
  they have no milestones). Production's BOM view and Stores' Material-Issued tab
  (`GET /api/projects/[id]/bom`, the one route both actually call) now only return items with
  `purchase_status IN ('Received','In-Stock')` — Stores has to have it in hand first. Dispatch can
  only pull a line into a new packing list once Production explicitly marks it done — new
  `bom_items.production_done` column, owned by Production (`BOM_FIELD_OWNERS`), toggled inline in
  `BomTable.jsx`'s new "Prod. Done" column; `getProjectBom()`'s `readyForPacking` (a new field,
  kept separate from the existing `pending` — which still feeds the generic cross-department
  "Pending" badge and shouldn't change meaning on old rows) is what `/api/packing/from-bom` and
  the pending-dispatch PDF actually pull from now.
- **Milestone automation** (`lib/milestone-auto.js`) — most milestones complete themselves off the
  real event that finishes the work, instead of only ever being hand-marked in the drawer. Wired
  into the API route that owns each event, one-way (pending → done only, never auto-reopens, same
  semantics the manual PATCH route already had):
  - **Production's 12 milestones** (Marking/Cutting .. Painting) — done once every job card raised
    against that `milestone_id` reaches `done` (`app/api/job-cards/[id]/route.js`).
  - **Hydro Test** — done on a passing `qc_records` row (`app/api/qc-records` POST/PATCH).
  - **Packing** — done once a `packing_lists` row for the project reaches `packed`/`dispatched`
    (`app/api/packing/[id]/route.js`).
  - **Procurement's 5 milestones, redesigned** — the old per-material-category set (Order BQ/Tubes,
    Procure Tubes, Order MS, Order Valves, Order Panel) had nothing in the data model tagging a BOM
    item by category, so they could only ever be hand-marked with no real signal. Replaced with
    `procurement_enquiry`/`comparison`/`ordered`/`transit`/`procured`, mirroring the BOM item's own
    `purchase_status` stages (`lib/bom-fields.mjs` `ACTIVE_STAGES`) — a milestone completes once
    *every* BOM item on the project has moved at least that far along ("all items must clear the
    stage," `syncProcurementMilestones`, called from the one real choke point
    `advancePurchaseStatus` in `lib/procurement.js` plus the manual Status-tab PATCH, cancel route,
    and Stores' Issue-to-In-Stock path). Existing projects' old 5 milestone rows were renamed in
    place by a `system_migrations`-gated one-time migration (`scope_of_supply...` — see below for
    the naming, this one's marker is a similar one-off in `lib/db.js`), not left inconsistent
    between old and new projects.
  - **Design Approval** — no single "customer approves the whole design" action exists, so this
    aggregates the existing per-drawing customer approval
    (`calc_drawings.customer_approved_at`, `app/api/calc-drawings/[id]/approve`): done once every
    customer-visible drawing on the project has been approved (needs at least one to conclude
    anything).
  - **Design** (the milestone) and **Site Installation / Commissioning** have no reliable signal
    anywhere else in the app — real explicit actions instead of the generic drawer: an "Approve
    Design" button (Design Head only, `DesignPanel.jsx`) and a "Mark complete" button per
    Installation milestone (`components/InstallationMilestoneActions.jsx`).
  - **Release BOM** stays a deliberate whole-project action too (a project's BOM usually builds up
    piecemeal over days — the first item landing isn't "released"), now with a real button (see
    Requests below) instead of only the generic drawer.
- **Requests (`/pr`) rebuilt with a sidebar** (`components/PrWorkspace.jsx`, `WorkspaceSidebar`):
  **Raise PR** (unchanged), **Release BOM** (project picker + status + the button above,
  `POST /api/projects/[id]/release-bom`), **Templates** (new — `bom_templates`/
  `bom_template_items` tables, create/apply/delete a reusable per-boiler-model material list;
  applying one materializes `bom_items` the same shape a normal PR line gets, `purchase_status`
  `Enquiry` + `pending_review=1`, so Stores still reviews it first).
- **Scope of Supply, completed** — the earlier "lean" pass (one `scope_of_supply` row per Sale
  Order line item) fit the data but not the real document: the client's own Order Acknowledgement
  paper form is a header (client block, Job No/Offer/PO refs, GST No, payment/freight/delivery
  terms, prepared-by) plus priced line items (SL/Product/Qty/Unit Price/Basic Value) plus totals
  (Basic Total/GST/Grand Total). `scope_of_supply` went back to being a document header (one or
  more per project, same "second WO" precedent as before this pass); new `scope_of_supply_items`
  is the priced line-item table (`unit_price`, `amount` — defaults to qty×unit price, an explicit
  amount always wins for lump-sum lines). New header columns: `po_no`, `po_date`,
  `payment_terms` (prefilled from the originating quotation), `freight_terms`, `delivery_terms`,
  `prepared_by`, `tax_pct` (default 18). Existing flat lean-pass rows were migrated into
  header+items per project by a `system_migrations`-gated one-time pass
  (`scope_of_supply_document_shape_v1`). `lib/data.js`'s `getScopeOfSupply()` now returns each
  header with its `items`, computed `basicTotal`/`taxAmount`/`grandTotal`, and the client/Job-No/
  Offer context joined from `projects → customers` / `sale_orders → quotations` (not duplicated
  onto every row). New item CRUD routes (`app/api/scope-of-supply/[id]/items[/[itemId]]`), and a
  PDF export (`lib/sos-pdf.js`, modeled directly on `lib/quotation-pdf.js`'s
  `@react-pdf/renderer` shape) matching the reference document's layout, at
  `GET /api/scope-of-supply/[id]/pdf`. `components/ScopeOfSupplyPanel.jsx` rewritten to match:
  inline-editable header fields, a priced item table with add/edit/delete, live totals, and a PDF
  download link.
- **Demo data** (`scripts/seed-demo-pipeline.mjs`) extended from 3 hand-frozen projects to 11, so
  every milestone-owning department (Design/Procurement/Production/Dispatch/Installation) has
  ≥2 projects genuinely active with it — verified directly against `getProjectsWithStatus()`'s own
  `activeDepartments`-equivalent logic, not just eyeballed.
- **Help — Milestone Tracker.** Each manufacturing department's guide
  (`components/department-help-content.jsx`) gets a new "Milestone Tracker" feature page — a table
  (reusing `GuideBody`'s existing `item.table` renderer, no new UI) listing every milestone that
  department owns, whether it's Automatic or an Explicit action, and exactly what completes it —
  the human-readable mirror of `lib/milestone-auto.js`.

## 5i. Responsibility model + Action Permissions (2026-08-18, no separate working-spec doc — folded straight in here)

Generalizes a pattern that used to exist only for Design/Engineering (a hardcoded Head/Designer
`<select>` pair in the Access Matrix, with Design's Head-only actions hand-checked via
`hasActiveDesignResponsibility`) into every department, plus a real admin-configurable engine for
*which* actions are Head-only. Four layers, built in one pass:

**1. Data model — `lib/department-roles.js`.** `users.department_roles` was already a generic
`{dept: 'head'|'designer'} ` JSON column (`lib/db.js`); only its *usage* was Design/Engineering-only
before this pass. The non-head tier keeps the literal stored value `'designer'` everywhere — it was
already `departmentRole()`'s (`lib/auth.js`) department-agnostic fallback token, not actually
Design-specific, so there was nothing to migrate. `RESPONSIBILITY_LABELS` maps `{department: {head,
designer}}` to a display label per department (`"QC Head"/"Inspector"`, `"Sales Head"/"Sales
Executive"`, etc. — drafted this session, not yet reviewed against how the team actually talks);
`responsibilityLabel(dept, value)` reads it with a sane fallback.

**2. Backend — `lib/auth.js`.** `isDepartmentHead(user, dept)` / `isDepartmentMember(user, dept)`
are the generic, department-agnostic checks (PM always passes; otherwise real department access +
`departmentRole(user, dept) === 'head'`/`'designer'`). `isDesignHead`/`isDesignDesigner` are now
one-line aliases over these — every pre-existing call site (formula approval, drawing deletion,
Design self-service access management) is unchanged. `app/api/users/[id]/route.js`'s
`departmentRoles` PATCH validates against the real `DEPARTMENTS` list (`lib/milestones.js`) and
`RESPONSIBILITY_VALUES`, not a hardcoded `['Design', 'Engineering']`.

**3. UI — `components/AccessMatrix.jsx`.** The two hardcoded "Design responsibility"/"Engineering
responsibility" columns became one **Responsibility** column: for each head, one compact
`<select>` per granted department (only departments they're actually checked into render a
dropdown), driven by `RESPONSIBILITY_LABELS` instead of two hand-written `<option>` blocks.

**4. Action Permissions engine — `lib/action-permissions.js` + `action_permissions` table.** The
actual per-action Head-gate, admin-configurable from Settings → **Action Permissions**
(`components/ActionPermissionsPanel.jsx`), one department at a time, each action a plain
Everyone/Head-only `<select>` (not drag-and-drop — a single two-state toggle per row does
everything a drag target would, with none of the reorder-state or touch-handling code that buys
nothing here).
- `ACTION_CATALOG` is the full list of gated actions, one entry per real mutation, department by
  department — see the file itself for the current count per department, kept current as the
  source of truth rather than duplicated here.
- `action_permissions (department, action_key, requires_head)` stores the toggle; no row for an
  action means it defaults **open to everyone with department access** — the same behavior every
  one of these routes had before this table existed, so wiring a new action in without configuring
  it is a no-op, never a silent lockout.
- `canPerformAction(user, department, actionKey)` is the one true check: PM always passes; a
  non-head who isn't granted `department` fails outright; otherwise it's open unless
  `requires_head` is set, in which case it needs `isDepartmentHead`. `requireAction(...)` is the
  route-ergonomic null-or-403 wrapper (same shape as `requireDepartment`).
- **Shared-record departments**: some entities don't belong to one fixed department — an
  Opportunity/Lead/CRM Task can be owned by either Sales or Marketing (`owner_dept`/`department`
  column on the row itself, resolved server-side at creation, read back on every edit — this
  already existed in `app/api/opportunities/[id]/route.js` etc. before this pass, just not used
  for a permission gate yet). Those routes call `requireAction(user, <the record's own resolved
  department>, actionKey)`, never the acting user's department — a Sales Head editing a
  Marketing-owned opportunity is still a Marketing action. `requireCrmAction(user, actionKey)` is
  the *other* shared shape — routes gated by `canAccessCrm` (Sales OR Marketing OR PM) with no
  per-record department of their own (customers, quotations, Sale Orders) — picks whichever of the
  two the acting user actually has, Sales first (matches how Sales' own help docs already describe
  ownership).
- **Deliberately not wired**, each a real boundary, not an oversight:
  - **Design's own hardcoded gates** (formula approval, drawing/file deletion, calc/drawing
    approval — `hasActiveDesignResponsibility` call sites) predate this table and stay
    non-configurable on purpose; migrating a stable, always-Head-only rule into a toggle a PM could
    flip open is a bigger, riskier change than generalizing the *mechanism* was.
  - **CRM Notes** (`crm-notes`) — an append-only activity log with no `owner_dept` of its own and
    no per-record department check even today (any CRM-access user can note any record); gating it
    would invent a rule that doesn't exist yet.
  - **The generic cross-department task/incident system** (`app/api/production/tasks`, backing
    every department's own Tasks board and Operations' Incidents panel) — inherently
    inter-departmental by design (any department can raise a task aimed at any other), doesn't fit
    a single-department Head/Member model.
  - **Material issued to WIP**, **hydro test records** (inside a QC-owned route, but the action is
    Production's), **purchase requisitions** (any department can raise one) — genuinely shared
    across departments; forcing one into a single department's bucket would misattribute it.

## 5j. Future Workflow Intelligence / Dependency Engine (2026-08-18, v1 observational + a first slice of the roadmap — no working-spec doc, folded straight in here)

A first pass at making the workflow system reason about *why* something is blocked and *who*
unblocks it, instead of every gate being a one-off hand-rolled check re-derived per feature. v1
is deliberately small and read-only: it computes a signal, it does not enforce anything yet, and
it does not decide any business question the code itself can't already prove.

### Current Dependency Engine v1

- **`depends_on_key`** (`milestones` table) existed in schema from the original redesign but was
  never read or written by any code — confirmed by a full-repo grep before this work started. v1
  makes it real.
- **Seeding** (`lib/db.js`, `createProjectMilestones`, fixed 2026-08-18 — see "Real bug found and
  fixed" below): every new project's `depends_on_key` is read from `currentDependsOnKeyMap()` —
  whatever's currently configured system-wide (via the admin UI below), keyed by `milestone_key`.
  Only a `milestone_key` that has never appeared in any project yet falls back to plain
  `MILESTONE_TEMPLATE` order. The original one-time historical backfill (`backfillDependsOnKey`,
  which gave every pre-2026-08-18 row its first value) already ran against the real DB and has
  been removed from `migrate()` — it must never run as a standing migration (see below for why).
- **`lib/dependency.mjs`** — pure module (no framework imports, safe for client components and
  plain `node --test`, same shape as `lib/handoff.mjs`/`lib/bom-fields.mjs`).
  `milestoneReadiness(m, rows, bomItems)` returns `{ ready, blocked_by }` for one milestone:
  already-done milestones are always `ready`; otherwise it checks the structural predecessor
  (`depends_on_key` target not done → `blocked_by: {type:'milestone', ...}`), then a small
  `READINESS_CHECKS` table of live-signal checks keyed by `milestone_key` (currently one entry,
  see below) → `blocked_by: {type:'signal', ...}`. `projectDependencyStatus(rows, bomItems)` maps
  a whole project's milestones through it.
- **`lib/data.js`, `getProjectDetail()`** — computes `blocked_by` fresh on every read (not stored,
  not cached — no staleness risk) and attaches it additively to each milestone object it returns.
  Feeds the BOM signal query with the same shape `syncProcurementMilestones` already uses.
- **`blocked_by` is now surfaced everywhere a milestone renders**: `MilestoneCard.jsx`,
  `MilestoneGrid.jsx` (bulk-edit, new "Dependency" column), `MilestoneDrawer.jsx` (detail sheet),
  and `ProjectHeader.jsx` (a separate muted summary line — deliberately its own line, not merged
  into the existing SLA/human-status-driven `biggestBlocker` hero above it, same "don't conflate
  the two facts" boundary as `effectiveStatus()`).
- **`outOfOrderFlag(m, rows)` / `out_of_order`** (`lib/dependency.mjs`) — the "cross-record
  consistency" gap the v1 audit found: a milestone can be marked done while its own structural
  predecessor isn't, and `milestoneReadiness()`'s own done-short-circuit never looks back to catch
  it. This is the dedicated check for that case — read-only, same `blocked_by`-shaped surfacing
  (`MilestoneCard`/`MilestoneGrid`/`MilestoneDrawer`, a muted "⚠ Finished ahead of…" line).
- **Structural-chain admin UI** (`components/DependencyChainPanel.jsx`, Settings → Access
  Management, PM-only) — the actual mechanism for resolving the "Unresolved business questions"
  below: one dropdown per milestone picking its structural predecessor (or "None"). An edit
  updates `depends_on_key` for that `milestone_key` across every project at once
  (`PATCH /api/dependency-chain`), not just future ones. Server-side cycle guard (walks the
  chain-as-it-would-read after the edit; `milestoneReadiness()` itself only ever checks one hop
  up, so a cycle wouldn't crash it, but it would leave two milestones permanently "blocked by"
  each other) plus self-reference and unknown-key rejection. Settings also flags if a
  `milestone_key`'s `depends_on_key` has ever diverged across projects ("mixed") — not expected
  today (every row so far came from the same uniform seed/backfill), but the column is per-row,
  so it's checked rather than assumed.
- **Real bug found and fixed (2026-08-18)**: a PM/head's confirmed answer in the admin UI did not
  actually survive into new projects, and could silently revert on its own. Two compounding
  causes, both fixed:
  1. `createProjectMilestones` originally always re-derived `depends_on_key` from plain
     `MILESTONE_TEMPLATE` order, never reading what the admin UI had configured — so a new project
     (real or demo) created after an edit would quietly get the old template default back. Fixed
     by `currentDependsOnKeyMap()` (above).
  2. Worse: `backfillDependsOnKey`'s old guard — "any row with `depends_on_key IS NULL` still
     needs backfilling" — became actively wrong the moment "None" (`NULL`) became a legitimate
     admin-configured value (a milestone with no structural predecessor). Since it re-ran on every
     `migrate()` call (every server restart in production; every dev-mode module reload while
     testing), it would silently overwrite a just-confirmed "None" back to the template-order
     default the next time the process restarted — indistinguishable, from its own point of view,
     from data that had simply never been migrated yet. Fixed by removing it entirely from
     `migrate()`'s recurring path — its one-time job on the real DB was already done.
  Verified live end-to-end: set a real intra-Production edge to "None" via the API, created a
  genuinely new project through the real `POST /api/projects` flow (not seed data), confirmed via
  direct DB query that the new project's row picked up `NULL` correctly, confirmed the value
  survives a full server restart. All test projects created during this verification were deleted
  afterward (matched by name, `LIKE '%DELETE ME%'`, checked against the pre-existing 11 real
  projects first) and the test edge was restored to its original default — no seeded/demo project
  data was touched.
- **Permission-aware UI** (roadmap item 4) — one concrete slice done: Installation's "Mark
  complete" button (`InstallationMilestoneActions.jsx`) now renders based on
  `canPerformAction(user, 'Installation', 'installation.milestone.complete')`
  (`app/projects/[id]/page.js`) instead of the coarser `canAccessDepartment` check it used before
  — a Member who'd get a 403 from the real server-side gate (`app/api/milestones/[id]/route.js`)
  no longer sees the button at all. The other ~64 actions in `ACTION_CATALOG` aren't wired to any
  UI yet — this was the one action already both Head-gateable *and* had a dedicated button to gate.
- **Head-only notification routing** (roadmap item 5) — `notifyDepartment()` (`lib/notify.js`)
  takes an optional `actionKey`; when given and that `(department, actionKey)` is configured
  `requires_head` in `action_permissions`, the department-derived recipient list narrows to Heads
  only (an explicit `assignedTo` still always reaches that person regardless). Wired at the one
  clean 1:1 match found: `POST /api/procurement-requests` notifying Procurement narrows to Heads
  when `procurement.request.decide` (the accept/reject action) is Head-gated — a Member who
  couldn't decide it anyway doesn't get the chime. Every other `notifyDepartment` call site is
  unchanged (`actionKey` omitted defaults to the old full-department fan-out); most existing calls
  don't have as unambiguous a 1:1 action match and weren't force-fitted into one.
- **ACTION_CATALOG audit (2026-08-18)** — verified, not assumed: cross-referenced all 82 catalog
  entries against every real `requireAction`/`requireCrmAction` call site in `app/api`. Clean —
  every catalog key has a real route enforcing it, every route's key exists in the catalog, no
  orphans. Three entries looked unwired on a naive literal-string grep
  (`procurement.po.issue/unissue/cancel`, `procurement.supplier.deactivate`,
  `production.worker.deactivate`) but are dispatched via an object-literal map
  (`purchase-orders/[id]/route.js`'s `PO_ACTION_KEYS`) or a ternary
  (`suppliers/[id]/route.js`, `production/workers/[id]/route.js`) — read all three directly and
  confirmed every real mutation branch is gated on every request path, not a bypass. §5i's "~65
  actions" undercounts; it's 82.
- **Dependency-health rollup** (`lib/data.js` `getDependencyHealthSummary()`, Executive page) —
  cross-project `blocked_by`/`out_of_order` counts, since both were otherwise only visible one
  project at a time. Two cards: dependency-blocked counts by department, and every current
  out-of-order flag with a link to its project. This is the actual "let real usage teach us"
  instrument, not just a hope — and it immediately found two genuine anomalies in existing seed
  data on first load (SB-1023: Procurement's Enquiry stage finished while Design's Release All
  Drawings — several milestones upstream — still hasn't), confirmed real by opening the project
  directly (all 4 BOM items already `Received`, drawings milestone still `Not started`).
- **Deliberately untouched**: the human-settable `milestones.status = 'blocked'` and
  `lib/sla.js`'s `effectiveStatus()`/`SEVERITY` ranking. Dependency-blocked is a distinct fact from
  a person marking something blocked for a real-world reason (vendor delay, etc.) — they are not
  merged, and no decision has been made yet about how a future UI should rank/combine the two.
- **Tests**: `lib/dependency.test.mjs`, 13 cases (`node --test lib/dependency.test.mjs`), covering
  the sequential chain, reopened predecessors re-blocking their successor, a human `'blocked'`
  status not affecting the computed dependency signal, an already-done milestone always reading
  ready, a stale/missing `depends_on_key` target failing open (`ready: true`, no crash) rather
  than failing loud, and `outOfOrderFlag()`'s own cases. Verified live against seeded project data
  in the browser and against several synthetic edge-case states run directly through
  `milestoneReadiness()`. The admin UI's cycle guard, self-reference rejection, and unknown-key
  validation were verified live via direct API calls (accept/reject cycle correctly rejected,
  edits correctly applied then reverted, `lib/handoff.test.mjs`/`lib/date.test.mjs` re-run
  alongside — 26 tests total, all passing).
- **Two correctness fixes made after the initial build**, both applied and re-verified (tests +
  live check), before any further work was allowed to proceed:
  1. **`pending_review` handling** — `getProjectDetail()`'s BOM signal query now excludes
     `bom_items.pending_review = 1`, matching `getSourcingItems()`'s own visibility rule. Before
     this fix, a Manual-mode BOM line still sitting in Stores Review (invisible to and
     unactionable by Procurement) could make the engine report "Waiting on Procurement" for
     material Procurement had no way to act on.
  2. **Readiness-owner handling** — `READINESS_CHECKS` entries now return their own `department`
     in the result, instead of `milestoneReadiness()` hardcoding `'Procurement'` at the call site.
     Harmless with one entry; would have silently mislabeled the responsible department the moment
     a second, differently-owned check was added.

### Important findings — these are NOT the same thing

Auditing the existing codebase for this work surfaced four genuinely different kinds of
milestone-to-milestone relationship, all currently flattened into one `sort_order` sequence in
`MILESTONE_TEMPLATE`. **They must not be assumed equivalent**:

1. **Structural milestone ordering** — the plain fact that `MILESTONE_TEMPLATE` lists milestone A
   before milestone B. This is a display/default-seeding order, nothing more, unless one of the
   next three categories also happens to hold for that specific pair.
2. **Department handoffs** — `lib/handoff.mjs`'s `handoffTarget()` fires a notification at the
   *last* milestone of one department's run, to the *first* milestone of the next department's
   run. This is a notify-only relay, not a gate — it does not stop the next milestone from
   starting, and it deliberately treats same-department consecutive milestones as a non-event (no
   notification between them).
3. **Operational readiness gates based on live signals** — a handful of places where the code
   genuinely checks real state (not just "is the previous milestone marked done") before allowing
   or reporting something as ready. See the next section for the actual list — there are fewer of
   these, and they don't always point at the milestone `depends_on_key` currently names.
4. **Activities that may run in parallel** — several milestones the code neither gates nor
   notifies between, where nothing rules out the underlying shop-floor work happening concurrently.

The dependency-engine audit found the current `depends_on_key` seeding conflates categories 1 and
3 in most places (it always points at "the previous milestone," whether or not that predecessor is
a real operational prerequisite) — see "Unresolved business questions" below.

### Existing operational gates discovered (category 3, real code today)

These are the actual live-signal checks that exist in the app right now, independent of the new
dependency engine — some pre-date it, one (`marking_cutting`) is now also modeled in
`READINESS_CHECKS`:

- **Procurement visibility depends on `release_bom`**, not `release_drawings`.
  `lib/data.js`, `getSourcingItems()`: a `source='bom'` BOM line is invisible to Procurement's
  sourcing queue until `milestones.milestone_key = 'release_bom'` is `done` for that project. The
  current `depends_on_key` chain has `procurement_enquiry` pointing at `release_drawings` (its
  literal template predecessor) — one hop later than the code's real gate.
- **Production/Stores material visibility depends on BOM purchase/receipt state.**
  `lib/data.js` and related BOM queries scope Production/Stores views to
  `purchase_status IN ('Received', 'In-Stock')` — the same signal `derivePurchaseStage` (below)
  computes, not a milestone at all.
- **Packing eligibility depends on per-BOM-item `production_done`**, not the `painting` milestone.
  `lib/data.js`, `getProjectBom()`: `readyForPacking = pending.filter(b => b.production_done)`.
  The current `depends_on_key` chain has `packing` pointing at `painting` (its template
  predecessor) — a different, coarser signal than the real per-item gate.
- **Procurement milestone progression uses `derivePurchaseStage` / weakest-link logic.**
  `lib/bom-fields.mjs`'s `derivePurchaseStage(item)` is a hybrid: trusts `purchase_status` once
  it's reached an advanced stage (`Ordered/Transit/Received/Cancelled/In-Stock`), derives from
  `selected_quote_id`/`po_ref`/`quote_count` for the earlier, less-trustworthy stages.
  `lib/milestone-auto.js`'s `syncProcurementMilestones` completes each of the 5 procurement
  milestones once *every* BOM item on the project has reached at least that stage (the worst item
  gates the milestone) — this is one continuous signal bucketed into 5 thresholds, not 5
  independently-gated milestones each waiting on the one before it.
- **Production milestone completion comes from job-card state**, per milestone, independently.
  `lib/milestone-auto.js`'s `syncProductionMilestoneById`: a given Production milestone completes
  once every `job_cards` row raised against *that specific milestone* reaches `'done'`. Confirmed
  by reading `app/api/job-cards/route.js`'s POST handler directly: it only checks that the target
  milestone's `department === 'Production'` — nothing checks any other milestone's status before
  allowing a job card to be created or closed.
- **QC/Hydro Test milestone completion comes from actual QC records.**
  `lib/milestone-auto.js`'s `syncHydroTestMilestone`: completes off `qc_records` where
  `test_type` matches `/hydro/i` and `result = 'pass'` — independent of any other milestone.
- **Packing milestone completion comes from packing-list state.**
  `lib/milestone-auto.js`'s `syncPackingMilestone`: completes off `packing_lists.status` reaching
  `'packed'` or `'dispatched'` — independent of any other milestone.

### Unresolved business questions

**The actual dependency relationships between the 11 intra-Production milestones are intentionally
NOT decided.** The code proves no ordering constraint between them — `handoffTarget` treats same-
department consecutive milestones as a non-event, and `job_cards` creation has no predecessor
check at all. Nothing here should be inferred from generic manufacturing-industry knowledge; only
real operational data or Production department-head confirmation should settle it.

Marked **UNCONFIRMED — requires real operational data and/or Production department-head
confirmation**:

- `marking_cutting → drilling`
- `drilling → shell_welding`
- `shell_welding → site_marking`
- `site_marking → welding_fura`
- `welding_fura → box_up`
- `box_up → box_up_welding`
- `box_up_welding → tube_stay_welding`
- `tube_stay_welding → pad_plates`
- `pad_plates → smoke_box`
- `smoke_box → hydro_test`
- `hydro_test → refractory`
- `refractory → painting`

Also **UNCONFIRMED** — code shows an ordered milestone pair but proves no real prerequisite
between them (all fully manual, no auto-sync, no gating route found anywhere in the repo):

- `design → design_approval`
- `design_approval → release_bom`
- `release_bom → release_drawings`
- `packing → site_installation`
- `site_installation → commissioning`

**Known mismatches between the current `depends_on_key` chain and the one real gate that exists**
(not yet corrected — no dependency-model changes have been made beyond the two fixes listed
above):

- `procurement_enquiry.depends_on_key` = `release_drawings`, but the real enforced visibility gate
  (`getSourcingItems()`) checks `release_bom`.
- `packing.depends_on_key` = `painting`, but the real enforced gate (`getProjectBom()`) checks
  per-item `production_done`.

### Future intelligence roadmap

1. **Dependency-aware workflow** — PARTIALLY BUILT. The v1 engine (`lib/dependency.mjs`) is real
   and read-only; the structural chain itself is still only confirmed-correct for
   `marking_cutting` and the non-Production edges — the 12 intra-Production edges remain
   UNCONFIRMED (see below), and the admin UI to fix that now exists (`DependencyChainPanel.jsx`)
   but hasn't been exercised with a real Production-head decision yet.
2. **"Why is this blocked?" explanations** — BUILT. `blocked_by`/`out_of_order` now render on
   `ProjectHeader.jsx`, `MilestoneCard.jsx`, `MilestoneGrid.jsx`, and `MilestoneDrawer.jsx` — the
   real computed cause and department, not a bare badge. Kept deliberately separate from the
   SLA/human-status-driven `biggestBlocker` hero, per the "don't conflate" boundary above.
3. **Transition guardrails** — STILL NOT BUILT, on purpose. Needs #1's structural chain to be
   trustworthy first (i.e. the Production questions below settled) — building this now would
   enforce the 12 unconfirmed relationships as real restrictions on real users.
4. **Permission-aware UI** — ONE SLICE BUILT. Installation's "Mark complete" button now renders
   off `canPerformAction()` instead of a coarser department check (see §5j above). The other ~64
   actions in `ACTION_CATALOG` have no client-side gating yet — each would need its own button/UI
   surface identified and wired, same as this one was.
5. **Smarter notification routing** — ONE SLICE BUILT. `notifyDepartment()` takes an optional
   `actionKey` and narrows to Heads when that action is Head-gated; wired at the one clean 1:1
   match found (`procurement.request.decide`). Every other call site is still full-department
   fan-out — most don't have as clean a single-action mapping and weren't force-fitted into one.
6. **Impact-based escalation** — STILL NOT BUILT, on purpose, same reason as #3: a milestone that's
   "blocking other work" per an unconfirmed chain isn't a real signal to escalate harder on yet.
7. **Cross-record consistency checks** — BUILT (one case). `outOfOrderFlag()`/`out_of_order` flags
   a milestone finished while its structural predecessor wasn't — read-only, surfaced everywhere
   `blocked_by` is. Other kinds of cross-record disagreement (not just done-out-of-order) are still
   unbuilt.
8. **Extending Item Master/catalog linking** — NOT BUILT. Connecting `item_code` (§3.2) more deeply
   into the readiness signals, once real per-item identity is consistently available across
   BOM/Stores/Procurement.
9. **Pattern learning from accumulated operational data** — NOT BUILT, needs real history first.
   Once enough real project history exists, using it (rather than either guessed rules or a
   one-time department-head interview) to
   confirm or refine which milestone relationships are real, how long stages actually take, and
   which blockers actually predict downstream delay.

### Important architectural principle

**The goal is not to build a giant rules engine immediately.** The intended direction, in order:

```
current system state
  → understand dependencies
  → identify blockers
  → identify the responsible person/department
  → understand downstream impact
  → recommend/trigger the appropriate action
  → eventually, once enough historical data exists, learn patterns and make predictions
```

**Historical data and department-head input should eventually determine business relationships
that cannot be reliably established from code alone** — this applies directly to the Production
sequencing questions above, and to any future milestone relationship the code itself doesn't
already prove. Guessing them from generic manufacturing knowledge, or from `MILESTONE_TEMPLATE`'s
display order alone, is explicitly out of scope until one of those two sources is available.

**Frozen as of 2026-08-18**: intentionally sitting at "understand dependencies / identify
blockers / identify responsible department" in the pipeline above — the read-only signal layer
(`blocked_by`, `out_of_order`, the Executive rollup) plus the admin tool to correct the chain.
Explicitly not proceeding to guardrails, escalation, or any ML/statistical/Bayesian prediction
layer until real department-head input (via the Dependency Chain admin UI) and real project
history exist to ground it — not a timeline, a precondition. In the meantime, the system already
captures what future learning would need without any extra instrumentation: `depends_on_key`
edits are audited (`dependency_chain_edit`), every milestone status change is audited
(`milestone_edit`) with real timestamps, and `blocked_by`/`out_of_order` are computed live off
real state on every read rather than snapshotted — so nothing needs to be added now to make that
data available later, it just needs time and real usage to accumulate.

## 5k. Cutting & Remnant Management (2026-08-19, no separate working-spec doc — folded straight in here)

Client-raised, from a direct conversation about plate/section offcuts: a plate bought at (say)
1500×6000×10 mm is cut for a project, and the usable leftover should go back into stock as a
**remnant** for a later project instead of being re-bought or scrapped blindly. Two things were
missing to make that real: (1) inventory had no concept of a physical piece with dimensions — just
a scalar `on_hand` number — so there was nowhere for a remnant to live; (2) nothing checked a BOM's
required material against what stock actually had, so even a perfect remnant sitting in Stores
would never get found. Both are built now, layered additively on top of everything in §5e/§5g —
the existing scalar `on_hand`, `inventory_reservations`, `getSourcingItems`/`getOpenBomItems`
gating, and `reserveFromStock`'s split-on-shortfall pattern are all reused, not rewritten.

- **Piece-level stock (`stock_pieces`, `lib/stock-pieces.js`)** — opt-in per `inventory_items` row
  (`track_pieces=1`, set automatically the first time a piece is received). A piece carries `kind`
  (`plate` | `linear`), dimensions (`length_mm`/`width_mm`/`thickness_mm` for a plate;
  `length_mm`/`kg_per_m` for a linear section — angles/channels/beams/pipes/bars, cut by length
  since a non-rectangular profile's cross-section isn't `L×W×T`), a computed `weight_kg`
  (`length×width×thickness×density` for a plate, `length×kg_per_m` for linear — **weight is always
  derived from geometry, never hand-typed**, the other half of the client's original ask), and
  `status` (`available` | `reserved` | `consumed` | `scrap`). `parent_id` + `cut_at` chain a cut's
  outputs back to their source piece — no separate `cut_operations` header table; nothing needs
  attributes beyond that yet. A piece-tracked line's `on_hand` becomes a rollup (count of
  `available` pieces) so the existing Stores Inventory table needed zero changes to keep working.
  Codes are traceability ids in the shape the client actually asked for: `PL-0007` (root) →
  `PL-0007-U1` (used, consumed into a project) / `PL-0007-R1` (remnant, back in stock available) /
  `PL-0007-S1` (scrap). **Note:** this is a different id from `items.item_code` (§3.2) — that
  column is still import-only and unusable as a key (1 of 2,773 rows populated); piece codes are
  generated fresh by this engine and solve the same traceability need §3.2 could not.
- **Cut = the shop-floor moment (`cutPiece`)** — one transaction: source piece → `consumed`; each
  declared **used** piece → its own child row, `consumed`, linked to the project (+ BOM line if
  cutting a reserved piece); each declared **remnant** → a child row, `available`, `source='remnant'`
  — genuinely back in stock, matchable against a future BOM line exactly like a purchased piece;
  any leftover weight (`source − used − remnant`) → one `scrap` child, auto-computed, never typed.
  The operator only ever enters **what was used and what usable remnant they kept** — every weight,
  the scrap number, and the stock update are computed, matching the client's explicit UX ask ("hide
  most of this complexity... they just tell the system what they cut"). If the cut piece was
  `reserved` against a BOM line, that line's `purchase_status` flips to the same terminal
  **`In-Stock`** `issueReservation()` already uses (D9, §5e) — but only once every reserved piece
  against that line has actually been cut (a line needing qty 2 can be matched by 2 separate
  pieces; the first cut alone must not prematurely close the line).
- **Automatic remnant-to-BOM matching (`lib/remnant-match.js`) — the core of this round.** Triggered
  the moment Design clicks **Release BOM** (`POST /api/projects/[id]/release-bom`, after
  `markMilestoneDone`) and again on a single BOM-item add to an already-released project
  (`POST /api/bom-items`) — both best-effort, never blocking the underlying action. For every BOM
  line with a dimensional `category` (`plate`/`ms_section`/`angle`) and parsed numeric
  `category_fields_json` (length/width/thickness for a plate, length + a profile string for
  linear):
  1. Candidates: `stock_pieces` where `status='available'`, same `category`, and the inventory
     line's `moc` matches the BOM line's `moc` (normalized string comparison — same free-text
     nature as `bom_items.moc` today, not a grade taxonomy). Plate additionally requires thickness
     within a small tolerance and the required rectangle to fit **with rotation** —
     `(L≥reqL && W≥reqW) || (L≥reqW && W≥reqL)`; linear requires the profile/size string (reused
     from `inventory_items.spec`, no new column) to match and length to be sufficient. Sorted
     least-waste (smallest sufficient piece) first.
  2. Reserve up to the required qty (`qty_text`'s leading number, same parse `splitQtyText`
     already uses) via a conditional `UPDATE ... WHERE status='available'` per piece — the
     anti-double-booking guard: a piece already claimed by one match can never be won by a second,
     no wrapping transaction needed (same non-transactional precedent `reserveFromStock` itself
     already uses at this codebase's scale).
  3. **Full match** (found = required): no row split — the line itself is force-set
     `pending_review=1` (permanent), so it never satisfies `getSourcingItems()`'s
     `pending_review=0` gate and is hidden from Procurement forever, exactly like a manually
     reserved line today.
  4. **Partial match**: splits like `reserveFromStock` — original row's qty reduced to the unmet
     remainder (continues its normal Stores-review → Procure path unchanged), a cloned row carries
     the matched qty with `pending_review=1` forced. The reserved pieces point at the clone.
  5. **No match**: the line is untouched, proceeds exactly as before this feature existed.
  - **`reserveFromStock`'s split-clone bug, fixed as a side effect** — the original split INSERT
    (§5e) silently dropped `item_id`/`category`/`category_fields_json` on the fulfilled clone. Both
    callers now share one `cloneBomItemForSplit()` helper (`lib/procurement.js`) that carries them
    forward; `pending_review` stays a caller-supplied param so `reserveFromStock`'s own existing
    behavior (clone defaults to `pending_review=0`, unchanged) is untouched.
- **Two BOM-visibility queries had to learn about `stock_pieces.status='reserved'` directly**,
  because `purchase_status` alone can't represent "matched but not yet cut" without breaking an
  existing invariant: Stores' Open Requests (`getOpenBomItems`) and Production's BOM view
  (`GET /api/projects/[id]/bom`) are deliberately **mutually exclusive by `purchase_status`** (open
  vs. Received/In-Stock) — that's the whole point of the status column. A matched-but-not-cut line
  is simultaneously "Stores should see this is handled" and "Production should be able to cut it
  right now," which neither existing query's status filter alone can express. Fixed by adding a
  `reserved_piece_count` signal to both queries (a `stock_pieces` subquery, `purchase_status`
  itself never touched by matching) instead of inventing a new `purchase_status` value — Stores'
  Open Requests shows a **"Remnant reserved"** badge in place of "Stores Review" (no Procure
  button — it's already fulfilled) computed from that count; Production's BOM `GET` route
  `OR EXISTS`s the same reservation so the line appears there too, before `purchase_status` ever
  changes.
- **UI, minimal, reuses every existing primitive (Dialog/Card/Table/Select/Badge)** —
  `components/StoresWorkspace.jsx` gets a "Pieces" (layers icon) action per dimensional inventory
  row → a dialog listing pieces (code · dims · weight · status badge) with **Add piece** (receiving)
  and **Release** (un-reserve, e.g. after a cancelled BOM line) actions; `components/WorkersPanel.jsx`'s
  `ProductionBomTab` gets a **Cutting & remnant** list (dimensional lines only) with a **Cut**
  action — pre-filled with the reserved piece + required dims when matched, a manual
  stock-line-then-piece picker otherwise, live-computed Used/Remnant/Scrap weight preview as the
  operator types, submit disabled if used+remnant would exceed the source. `components/PrWorkspace.jsx`'s
  category-field dimension inputs (length/width/thickness) are now `type="number"` and required
  once a dimensional category is picked — the data matching actually needs, enforced going forward
  without touching historical rows.
- **Confirmed scope boundary**: matching only ever runs on BOM lines that already carry a
  structured `category` + numeric dims — i.e. lines entered through the PR/BOM composer with the
  category fields filled in. The dominant way Design actually populates a BOM, bulk PMB Excel
  import (§5a), writes pure free text and is completely unaffected — no regression, matching is
  simply never attempted on those rows. No 2D nesting/bin-packing (one sufficient piece per
  required unit, least-waste first — never combining several remnants to cover one oversized
  requirement); no mandatory dimension-confirm gate on import.
- **Self-check** (no JS test framework, same in-memory-libsql precedent as
  `scripts/advance-status-selfcheck.mjs`, since `lib/*.js` uses ESM `import` only loadable through
  Next's bundler): `node scripts/remnant-cutting-selfcheck.mjs` — weight formula (1000×2000×10 mild
  steel = 157 kg), full cut round-trip (used+remnant+scrap conserves the source weight, lineage
  correct), matching (thickness-mismatch rejection, rotated-fit acceptance, least-waste ordering,
  double-booking impossibility, partial-qty split correctness including the clone carrying its
  category link forward). `node scripts/seed-remnant-demo.mjs` seeds one demo project + one
  piece-tracked inventory line for an end-to-end browser walkthrough. Verified live against the
  real dev DB: a qty-2 demo BOM line with one matching remnant in stock → Release BOM reserved 1 of
  2 automatically and the line never appeared in Procurement's Enquiry queue → Stores' Open
  Requests showed "Remnant reserved" for the matched unit and a normal open line for the shortfall
  → Production's Cut (pre-filled 1800×900×10) produced a 127.17 kg used piece + a 15.7 kg remnant
  (back in Stores, available) + 14.13 kg scrap, summing exactly back to the 157 kg source, and the
  BOM line flipped to `In-Stock`.

### Item Master → Item Code, finished (2026-08-19 addendum)

§3.2 built the join key (`items.id`) but left `item_code` itself unusable (blank on all but 1 of
2,773 rows) and nothing downstream actually preferred catalog identity over free text. Closed, additively:

- **Every `items` row now has a real, unique code** — `IM-000042`-style sequential backfill for
  every previously-blank row (the 1 real pre-existing code, `ADBL0000001`, untouched), plus a
  partial `UNIQUE` index (`WHERE item_code IS NOT NULL`) so a duplicate can no longer be created —
  DB-enforced, not a convention. `bom_items.item_id`/`inventory_items.item_id` also got a one-time
  retroactive backfill using the exact same case/space-insensitive exact-name match the PMB
  import's own auto-link already trusted live (§5a) — reused, not reinvented. All one guarded
  migration (`backfillItemMasterIdentity`, `system_migrations` key `item_master_identity_v1`).
- **Remnant matching now checks Item Master identity before the moc-string fallback**
  (`lib/remnant-match.js`): `bom_items.item_id === inventory_items.item_id` is the strong signal
  when both sides are catalog-linked (real identity, not a guess) — dimensions/thickness/rotation
  are still checked after, unchanged. Either side missing `item_id` falls back to the existing
  normalized-moc comparison exactly as before, so free-typed BOM/stock lines keep matching exactly
  as they did pre-this-round; nothing regresses.
- **Display reuses dormant UI, not new UI**: `PrWorkspace`'s and `StoresWorkspace`'s catalog
  pickers already rendered `item_code` — silently blank until now purely because the data was
  blank. `getProjectBom`/`getInventoryItems`/`getOpenBomItems`/Production's BOM route now each
  `LEFT JOIN items` for a `catalog_item_code`, shown as a small muted line under the description in
  `BomTable`, Stores' Inventory table, and Production's Cutting & remnant list — no new column, no
  new component, same "reuse before building" pattern as everything else in §5k.
- **Deliberately not built**: no in-app "create a new Item Master row" flow (2,773 real rows
  already exist; free-typed lines simply stay free text until picked from the catalog, exactly
  today's behavior) — matches the explicit instruction not to invent a new identity for every BOM
  occurrence. `pr_items`/`po_items`/`stock_pieces`/`job_cards` get no new `item_id` column — each
  already reaches Item Master identity transitively through `bom_item_id`/`inventory_item_id`, so
  adding a redundant denormalized column would duplicate, not reuse.

### BOM creation → release baseline → templates (2026-08-19 addendum)

Closes the loop from BOM authoring through to a traceable production baseline, reusing calc_drawings
(Design's existing drawing system) and bom_templates (§5h) rather than inventing either concept fresh.

- **Drawing linking** — `bom_items.drawing_id` (live FK to `calc_drawings`, nullable, "where
  applicable"). `calc_drawings` never had a revision field at all; added one (`revision TEXT`,
  free text like every other spec field here) rather than a parallel drawing system — the "drawing
  number" is just the drawing's own existing `name`. Set per project-split row in the Raise PR
  composer (a drawing is inherently one project's; a line can still split across several), fetched
  lazily via the existing Design/Engineering-gated `GET /api/calc-drawings` — a Stores user raising
  a line simply never sees the picker, no error. `getProjectBom`/Production's BOM route now surface
  it (`drawing_name`/`drawing_revision`), shown inline in `BomTable` under the description.
- **Release baseline** — `projects.bom_release_revision` (increments once per Release BOM click) +
  `bom_items.released_at_revision` (stamped on every live line at that moment). No new table, no
  new workflow: "Work Order" traceability is just {project, this revision number,
  `bom_items.drawing_id`, job_cards via project_id/milestone_id/bom_item_id} — relationships that
  already existed. Deliberately a live FK to the drawing, not a frozen snapshot (calc_sheets'
  `calc_snapshots` is the pattern to reuse if a hard freeze is ever needed — not built here).
- **Release BOM readiness summary** — the GET status route now also returns `drawingLinked` and
  `nextRevision`; the tab shows "N BOM items · M drawings linked · K not linked" before the button.
  Informational only, never a hard gate — not every line needs a drawing.
- **Templates now carry the same identity a BOM line does** — `bom_template_items` gained
  `item_id`/`category`/`category_fields_json` (was material_description/moc/size_spec/qty_text
  only, so an applied line could never be remnant-matched or catalog-linked). The template composer
  reuses `ItemSearchField`/`CATEGORY_LABEL`/`CATEGORY_FIELD_DEFS` as-is. Drawing/revision
  deliberately NOT stored on templates — project-specific, never standard across boiler models.
  The apply route now also runs `matchAndReserve` per dimensional item when the target project's
  BOM is already released, the same late-add coverage the single bom-item POST route already had.
- **"Use template" moved into Raise PR** (`UseTemplateDialog`) — a compact modal (template picker +
  project picker + Apply) using the same `/api/bom-templates(/apply)` endpoints, so applying one
  doesn't mean leaving Raise PR. The Templates tab itself (create/manage) is unchanged.
- **`app/pr/page.js` header/sidebar bug fixed** — carried the same leftover pre-sidebar-redesign
  `PageHeader` + `<main>` wrapper `app/stores/page.js` was already fixed for (§ "Below-minimum
  filter" note); removed, same as that fix.
- **Real bug found and fixed live**: the drawing picker's async fetch (`onProjectChange`) closed
  over `line` from the render that triggered it — resolving after the user's own project-pick
  commit silently rolled it back. Fixed with a `lineRef` mirror read only by that one post-await
  update; every synchronous handler is untouched.

**Same-day follow-on** — template traceability, PDF export, un-release, and the Release BOM tab
becoming the actual management surface (not just a summary + button):

- **`bom_items.template_id`** (live FK to `bom_templates`, same lineage idiom as `import_id` →
  `bom_imports`) — every applied line now says which template it came from. `BomTable` shows
  `via {template name}` inline; the release-bom GET route returns `templatesApplied` (name + count
  per template on the project), rendered as a badge row above the table.
- **Multi-template apply is chain-friendly** — `UseTemplateDialog` no longer closes after one
  apply; it resets to let you pick another template against the same project, with a "Done" button
  once finished. A duplicate `item_id` already on the project (same template re-applied, or two
  templates sharing a line) prompts a plain `confirm()` before inserting a second copy — the same
  check now lives in both the Raise PR dialog and the older Templates-tab `ApplyTemplateDialog`,
  which needed the identical fix (it was silently reporting success on a skipped apply).
- **BOM PDF** — `lib/bom-pdf.js` (modeled directly on `lib/sos-pdf.js`, same `@react-pdf/renderer`
  approach) + `GET /api/projects/[id]/bom/pdf`. One landscape table: description, Item Code, MOC,
  size/spec, drawing, qty, status.
- **Un-release** — no new mechanism: reuses the existing generic `POST /api/milestones/[id]/reopen`
  (the same "send back for rework" action `TicketsPanel.jsx` already exposes for any milestone).
  `release_bom` is just another milestone, so reopening it needs a reason and un-does `markMilestoneDone`
  exactly like any other reopen. Revision counters never roll back — releasing again gets a fresh,
  higher `bom_release_revision`.
- **Release BOM tab now embeds `BomTable` directly** — the same searchable/editable/deletable table
  every department panel already uses, fed by a new `?all=1` mode on `GET /api/projects/[id]/bom`
  (delegates to `getProjectBom`, no second query shape). Release / PDF / Un-release moved into
  `CardAction` (top right), matching the placement pattern used elsewhere (e.g. Raise PR's "Use
  template" button). `BomTable` gained an optional `onSaved` callback — additive, every existing
  caller unaffected — because a client-fetched `bom` list (this tab, same as `ProductionBomTab`)
  never picks up `router.refresh()`'s server-prop refresh on its own.
- **Two real bugs, same root cause, fixed live**: `getProjectBom()` returns
  `{ bom, pending, readyForPacking, imports }`, not a bare array — the new `?all=1` branch and the
  PDF route both passed the whole object where `BomTable`/`bom-pdf.js` expected `bom.map(...)`,
  crashing the table and breaking the PDF download. Fixed both call sites to destructure `.bom`,
  matching every pre-existing caller (`app/projects/[id]/page.js`, `pending-pdf`, `packing/from-bom`).

## 5l. Work Orders — production-control layer above Job Cards (2026-08-19, STERP Priority 2/3 items 20-21-22-23-24-27-28-29, no separate working-spec doc — folded straight in here)

Closes out Production's remaining STERP list. Job Cards (§5g) were already the shop-floor execution
record — milestone-scoped, with time logs, consumables, and rework lineage — but there was no real
production-order entity above them. This adds one: `work_orders`, referencing a project's live BOM
release baseline (`bom_release_revision`, §5k) rather than a frozen copy, carrying a Process Route
Card and material requirements, and generating/linking the existing Job Cards underneath it. Nothing
about Job Cards' own execution model (time logs, consumables, rework) was rebuilt — a Work Order is
a new layer on top, not a replacement.

- **`work_orders`** — `wo_no` (`nextNumber('wo_no', 'WO')`, same counter idiom as `po_no`/`so_no`),
  `mode` (`against_order` | `against_stock`, items 22/23), `project_id`/`sale_order_id` (both
  nullable — a stock Work Order has neither), `qty_planned`, `bom_release_revision` (snapshotted
  from the project at creation, item 21's "linked to the approved BOM Release Revision"),
  `planned_start`/`planned_end`, `status` (`draft` → `released` → `in_progress` → `completed`, or
  `cancelled` from any open state).
- **`work_order_operations` is the Process Route Card (item 24)** — sequence, `operation_id`/
  `workstation_id` (the same masters §5g already built, not a parallel taxonomy),
  `milestone_id` (optional — mapping a route step to a real Production milestone keeps
  `lib/milestone-auto.js`'s existing automation firing for against_order Work Orders exactly as it
  does for hand-created cards), `department`, `planned_minutes`, `inputs`/`outputs`,
  `quality_checkpoint`. Only editable while the Work Order is `draft` — once released, routing is a
  baseline field, same lock as quantity/dates below.
- **`work_order_materials`** — the BOM/material link (item 21, and item 27's material-consumption
  rollup). A line either carries `bom_item_id` (against_order — issued quantity is read live off
  `material_issues`, never a second ledger) or its own `item_id`/`description` with a manual
  `qty_issued` column (against_stock, which has no `bom_items` row to point at — a small "Log issue"
  action updates it directly).
- **Job Cards get `work_order_id`/`work_order_operation_id`** (nullable — hand-created cards outside
  a Work Order are unaffected) and **`job_cards.project_id` becomes nullable** — a table rebuild
  (`relaxJobCardsProjectIdForWorkOrders`, same idiom as `reshapeJobCardsForMilestone`), the one real
  schema change against-stock Work Orders required, since a stock Work Order has no project for its
  generated cards to belong to. `POST /api/work-orders/[id]/generate-job-cards` creates one card per
  route step that doesn't already have one (safe to call again after adding a step later), so
  "generate/link multiple Job Cards" is one action instead of hand-creating each.
- **Work Order Process Tracking (item 27)** — `getWorkOrderDetail()`'s `progress` block: job-card
  completion (`qtyDone`/`qtyRejected` summed off linked cards), operation status per route step
  (`job_card_count`/`job_cards_done`), a `delayed` flag (past `planned_end`, not yet at target qty),
  and a rework count — all derived from existing relationships, no new tracking table.
- **Work Order Change Note (item 28)** — `work_order_change_notes` (field/old/new/reason). Once a
  Work Order is past `draft`, `qty_planned`/`planned_start`/`planned_end`/`product_description` can
  only move through `POST .../change-notes`, which applies the field and logs the note together;
  a direct `PATCH` on those fields 400s with a pointer to the Change Note route instead.
- **Work Order Costing (item 29)** — extends `getProjectCosting()` (Sales' own project-costing view,
  §5e) with an optional `workOrderId` param that scopes the labor query to that Work Order's own job
  cards, rather than building a second, possibly conflicting cost rollup. `getWorkOrderCosting()`
  reuses it for the actual side on against_order Work Orders (material stays project-scoped — POs
  aren't raised per-WO in this app); against_stock Work Orders, which have no project to reuse it
  against, compute actual cost directly off the same tables. Planned material is
  `Σ qty_required × unit_cost` (manually entered — this app has no item-level standard-rate master);
  planned labor is each route step's `planned_minutes × workstation.machine_hour_rate` where set.
  Subcontract/overhead: no cost field exists anywhere for outside-work vendor pricing or overhead
  allocation, so this lists the outside job cards instead of fabricating a number.
- **Production Forecasting (item 20)** — `getProductionForecast()`: released/in-progress Work Orders
  due within a horizon (their planned dates already come from project milestones/order dates at
  Work-Order-creation time — nothing new to derive there), their route cards' still-open planned
  time per workstation (flagged `overloaded` against a flat single-shift-per-day capacity assumption
  — `ponytail`: the upgrade path once this shop runs multiple shifts is a real capacity calendar, not
  needed yet), and their still-outstanding material lines (same live `material_issues` read as the
  detail view, so a BOM-linked line's outstanding quantity is real, not stale).
- **UI** — `components/WorkOrdersPanel.jsx` (list + create + the full detail sheet: route card,
  materials, linked job cards, change notes, costing) and `components/ProductionForecastPanel.jsx`,
  both new tabs on the existing Job Card `WorkspaceSidebar` (`components/WorkersPanel.jsx`) —
  **Work Orders** and **Forecast** — next to Job Card/BOM/Daily Sheet/Workers Roster, not a new nav
  item or page route.
- **Action Permissions** — `production.workorder.create`/`.edit`/`.release`/`.change_note`, same
  admin-configurable catalog (§5i) every other department action already goes through.
- **What this corrects in STERP.md**: the Priority 3 list previously showed **Job Card** and **Job
  Card Process Tracking** (items 25/26) as missing. They were already built in §5g (2026-08-16) —
  milestone-scoped cards, time logs, qty done/rejected, rework lineage — before this round even
  started; STERP.md's own labels were stale, not the app. Fixed in this pass (see STERP.md).

### Workspace UX pass, Operations pipeline card, and help doc (2026-08-19 addendum)

Same day, several follow-on rounds once the base Work Order build above landed and got used —
folded in here rather than a second dated section, since none of it is new architecture.

- **Workspace rename + sidebar order.** The top-level nav tab and `WorkspaceSidebar` title changed
  from **Job Card** to **Production** (`components/Nav.jsx`, `components/WorkersPanel.jsx`) — it
  now holds Work Orders/Job Card/BOM/Forecast/Daily Sheet/Workers Roster, not just the board. Job
  Card stays exactly as it was as a sub-tab, just reordered second (after Work Orders, the
  production-order control view) instead of first — same "workspace name ≠ default sub-tab" shape
  every other department tab already has. `/production/workers` (URL) and the default landing tab
  (`jobcards`) were deliberately left unchanged — only the label and ordering moved.
- **Work Orders / Job Cards get real filters**, both reusing existing server support rather than new
  endpoints: `WorkOrdersPanel.jsx` adds a Project filter next to the existing status filter —
  `GET /api/work-orders` already read `?project_id=`/`?status=`, just unused in the UI until now.
  `JobCardBoard.jsx` adds Project and Work Order filters, client-side only (the board's `jobCards`
  prop is already the full unfiltered list) — picking a Work Order auto-derives its project from the
  same `/api/work-orders` list, so a head isn't picking the same project twice. Cards and the detail
  sheet now show Project → Work Order → Operation context explicitly (`wo_no`/`wo_product_description`
  joined in).
- **Real bug fixed while wiring the above**: `getJobCards()`/`getJobCardDetail()` (§5g, predates
  Work Orders) inner-joined `projects` — an against_stock Work Order's generated cards
  (`job_cards.project_id` nullable, this section) would silently never appear on the board or in any
  project-filtered query. Both now `LEFT JOIN projects`, plus a new `LEFT JOIN work_orders` for the
  `wo_no`/`product_description` context above.
- **Operations' Production pipeline card** (`components/ProductionFlow.jsx`, `getProductionFlowCounts()`
  in `lib/data.js`) — new, same slot/precedent as `ProcurementFlow.jsx`/`StoresFlow.jsx`/`DesignFlow.jsx`
  on the shared Operations surface (§7's `app/page.js`, also serving `/ops`). Two spines:
  1. **The primary lifecycle** — after one relaunch this session to match the real end-to-end flow —
     is **Production Ready → Work Order Created → Work Order Released → Job Cards → Execution →
     QC/Rework → Completed**, aggregate counts across every active project/Work Order, not a
     per-project view. **Production Ready** is genuinely new logic, not a rename: an active project
     counts only once *every* BOM line at its current `bom_release_revision` has reached a real
     terminal `purchase_status` (`Received`/`In-Stock`/`Cancelled` — reusing `lib/bom-fields.mjs`'s
     own `EXIT_STAGES`, not a parallel vocabulary), a project-level readiness state, not a BOM-line
     count. The rest of the spine reads straight off `work_orders.status` and `job_cards.status`
     (WO-linked only — ad hoc cards are the secondary spine below), open Hydro Tests, and open rework
     cards. Every stage is a real drill-through `Link` into the actual filtered view behind its
     number (Work Orders' status filter above, the Job Card board, or the Projects list) — read the
     number, click it, land on the real records.
  2. **The secondary Job Card status spine** (unchanged throughout) — every Job Card, work-order-linked
     or ad hoc, by status (Pending/In Progress/Done), with open Rework as a branch off Done. Ad hoc
     cards skip the lifecycle spine entirely (no Work Order behind them), so this is where they stay
     visible.
  **Route/Operations, Material, Labour, Costing, Forecast, and Change Notes are supporting/control
  indicator chips above both spines, not sequence stages** — Execution already covers route
  operations, labour, and material consumption/cutting happening underneath it; Labour/Costing have
  no cheap existing aggregate across every open Work Order to reuse, so those two chips are plain
  links into where the real per-Work-Order numbers already live (open a Work Order, Load Costing),
  same precedent Costing always used.
  Both spines wrap left-to-right at any width (flex-wrap, one box+arrow per flex item) instead of
  horizontal scroll — a box that no longer fits drops to the next row on its own, arrow included.
- **`/help` doc caught up** (`components/department-help-content.jsx`, `components/DepartmentHelpWorkspace.jsx`):
  Production's Work Orders/Forecast feature pages got real tailored content (they were falling back
  to the generic per-feature boilerplate every other department's untouched features still use).
  **How To** was split from one generic 7-step chain into **11 focused per-action walkthroughs**
  (Create a Job Card, Set up a Work Order, Log work on a card, Cut material, Record a Hydro Test,
  Start/close a milestone, Handle exceptions, Add a worker, Mark attendance, Raise a handoff, Close
  the day), ordered as a real workflow sequence — same visual pattern as the Notifications
  Customer/Departmental group (§5f-adjacent), generalized into a reusable `guide.howToGroups` shape
  in the shared renderer (opt-in — every other department's flat `guide.howTo` is untouched). Caught
  a real positional bug doing this: the renderer's "why this step matters"/"before you continue" text
  was matched to steps by array *index*, not content — expanding Production's step count silently
  mismatched the pairing; fixed by giving Production's own steps explicit `why`/`verify` text, which
  the renderer already preferred over the positional fallback. The Introduction page also gained an
  opt-in `guide.introFlow` — a small boxes-and-arrows diagram (plain Tailwind flexbox, no charting
  library, matching this app's existing hand-built-diagram precedent) showing the one genuinely
  branching relationship worth drawing: Work Order vs. ad hoc Job Card, both converging into the same
  execution/milestone-completion path.

## 5m. Production — target navigation & module architecture (2026-08-19, documentation only — nothing in this section is built; do not treat any workspace/tab named here as existing until it has its own dated as-built section like §5l's)

The source of truth for **where a new Production capability belongs**, written down now so a
future chat doesn't have to re-derive it or guess. This section is the target shape; §5g/§5l/§5l's
addendum above are what's actually built today, and §8's "Production's next layer" paragraph is the
prioritized roadmap this architecture organizes. Nothing here changes the current UI — Production
today is still one workspace (Work Orders/Job Card/BOM/Forecast/Daily Sheet/Workers Roster, per
§5l's addendum), and stays that way until a specific future round explicitly builds one of the
workspaces below and gets its own as-built write-up.

**The model: two navigation levels, not one flat list.**
1. **Main tabs** — major business workspaces with distinct ownership, decisions, and end-to-end
   workflow (the top nav bar today: Home/Operations/Projects/Production/Procurement/etc., §3).
2. **Sidebar tabs** — operational views/functions belonging to one workspace (Production's own
   `WorkspaceSidebar` today: Work Orders, Job Card, BOM, Forecast, Daily Sheet, Workers Roster).

Do not create a new main tab for every feature or every new table. A capability earns a main tab
only by passing the test at the end of this section — otherwise it stays a sidebar tab, a
supporting indicator (same precedent §5l's addendum already set: Route/Operations, Material,
Labour, Costing, Forecast, and Change Notes are indicator chips around the Production lifecycle,
not stages or tabs of their own), or a contextual feature inside an existing workspace.

### Target main workspaces

**PRODUCTION — shop-floor execution (exists today, §5g/§5l).** "What is being produced and what is
happening on the factory floor?" Sidebar, target shape: Work Orders, Job Cards, Daily Sheet,
Workers, BOM/Materials, Operations — close to what's built now (§5l's addendum's actual current
order is Work Orders/Job Card/BOM/Forecast/Daily Sheet/Workers Roster; Forecast moves to the
Planning workspace once that exists, per below, and Operations/Materials are today folded into BOM
and the route card rather than split out — no change to today's sidebar from this section alone).
Owns the execution lifecycle documented in §5l's addendum: **Production Ready → Work Order Created
→ Work Order Released → Job Cards → Execution → QC/Rework → Completed**. Route/Operations, material
consumption, labour, and costing stay supporting layers around this lifecycle, never separate
primary stages — and the existing link chain, **Project → Work Order → Job Cards**
(`work_orders.project_id`, `job_cards.work_order_id`, both already real columns, §5l), must stay
intact through any future change here.

**PLANNING — production planning and control (not built; §8 roadmap items 1-2).** Create as a
separate main workspace *only once* the planning capabilities below are actually implemented — not
before. Target sidebar: Production Schedule, Capacity, Bottlenecks, Material Availability/Pegging,
Forecast. Purpose: "What should we produce, when, where, and do we have the capacity and materials
to do it?" This is where §8's roadmap items 1 (finite production scheduling + capacity/bottleneck
management) and 2 (material shortage/availability pegging) belong, plus Forecast itself — moved out
of Production's own sidebar once Planning exists, since Forecast is inherently a look-ahead/what-if
surface, not shop-floor execution. Build extends `getProductionForecast()` (§5l — already computes
workstation load and material demand) rather than a second forecasting engine; capacity/bottleneck
work extends the same `overloaded` signal that function already flags, not a parallel one.

**QUALITY — quality control and manufacturing quality (partially built as QC's own department,
§5b; roadmap items 3-5 not built).** Quality stays QC's own department-level workspace — it does
**not** become a Production sidebar tab, now or later. Target sidebar (extending QC's existing
`qc_records` module, §5b, not replacing it): Inspections, ITP, NCR/Disposition, Test Certificates,
Traceability. Production hands work to Quality (a Job Card, a route step's `quality_checkpoint`);
Quality returns a pass/fail/rework/disposition decision back to Production (today: `qc_records` +
Job Cards' `rework_of_job_card_id`/`qc_record_id` lineage, §5g). §8's roadmap items 3 (formal
NCR/disposition/ITP), 4 (material heat/lot traceability), and 5 (welding/fabrication traceability)
belong here, extending `qc_records` and the Test Certificate bank (§5d) — never a duplicate
quality-record table living inside Production.

**MAINTENANCE — equipment reliability (not built; §8 roadmap item 7).** Create as a separate main
workspace once implemented. Target sidebar: Machines/Equipment, Maintenance Schedule, Breakdown/
Downtime, OEE. Maintenance owns equipment availability and reliability; Production *consumes*
machine/workstation availability (extending the existing `workstations` master, §5g, which today
only carries `name`/`machine_hour_rate`) rather than duplicating maintenance records inside
Production.

### Capabilities that must not become their own main tab

Each of these extends an existing workflow instead — naming the real table/function each should
extend, not a fresh one:

- Material traceability → extends `stock_pieces`' existing piece-level lineage (§5k)
- Heat/lot traceability → extends the same `stock_pieces` lineage, a new field, not a new module
- Welding traceability → attaches to Welding Job Cards (`job_cards.operation_id`) + Quality records
- WPS/PQR/welder qualification → Production/Quality context, not a standalone workspace
- Subcontract/outside process → extends `job_cards.is_outside`/`outside_vendor` (§5g), not a new flow
- Labour/time tracking → stays on Job Cards (`job_card_time_logs`, §5g)
- Costing → stays on Work Orders/Job Cards (`getWorkOrderCosting`/`getProjectCosting`, §5l)
- Route/Operations → stays on Work Orders/Job Cards (`work_order_operations`, §5l)
- Material consumption → stays on BOM/Job Cards (`material_issues`, §5g)
- Forecast → moves to the Planning workspace once it exists (extends `getProductionForecast()`)
- Bottleneck indicators → Planning workspace (extends Forecast's `overloaded` signal)
- Machine availability → Planning + Maintenance integration, not a Production-owned record

### Navigation rule — apply before adding any new tab

> Does this capability have its own business owner, decisions, records, and end-to-end workflow?

**Yes** → consider a main tab. **No** → it stays a sidebar tab, a supporting indicator, or a
contextual feature inside the appropriate existing main workspace. Never create navigation merely
because a new database table or feature exists — §5l's own relaunch is the precedent: Route/
Operations and Material were demoted from primary lifecycle stages to indicator chips specifically
because they failed this test against the Production lifecycle.

### Implementation rules for whoever builds any of this

- Preserve the existing premium, minimal, responsive navigation style (`WorkspaceSidebar`,
  `Nav.jsx` — same components, not a redesign).
- Do not duplicate existing workflow logic, status logic, APIs, or data sources — extend
  `work_orders`/`job_cards`/`qc_records`/`getProductionForecast()`/etc. wherever the capability
  already has a natural home, per the mappings above.
- Do not build any of PLANNING/QUALITY-as-expanded/MAINTENANCE merely to satisfy this
  documentation — each becomes real only when a future round actually implements it, and that round
  gets its own dated as-built section (same pattern as §5l) rather than silently editing this one.
- This section is the *target* architecture; current implementation status is tracked separately
  (§5g/§5l/§5l's addendum for what's built, §8 for what's roadmapped but not built) and must stay
  accurate on its own — don't let this section's "target" framing bleed into claiming something is
  built.
- When a future chat asks where a new Production capability belongs, this section is the answer —
  check it before adding a sidebar tab, a main tab, or a new indicator chip.
- Do not silently turn a roadmap capability into a new sidebar or main tab without updating this
  architecture section first, so it stays the accurate source of truth rather than drifting stale
  the way STERP.md's Job Card entries once did (§5l's own "what this corrects" note above).

## 5n. Installation — Service Calls, Service Contracts, Service Reports (2026-08-19, STERP items 7/36/37/38, no separate working-spec doc — folded straight in here)

Before this round, Installation had no workspace at all — a project's Installation tab (`InstallationMilestoneActions.jsx`) and its "Mark complete" action (§5i) were the entire department surface. This round built the rest of STERP's Installation scope: **Service Call Management** (item 36), **Service Contracts** (item 37), and **Service Reports** (items 7 and 38 — STERP lists "Service Reports" twice, once as installation-milestone-level reporting and once as dedicated service-call/contract reporting; both are the same ask at two levels of detail, built as one feature, not two).

**New top-level tab** — `/installation` (`app/installation/page.js` → `components/InstallationWorkspace.jsx`), added to `Nav.jsx`'s `addDeptTab` list (Installation previously had none). Same `WorkspaceSidebar` shell as every other department workspace (§5c/§5g precedent), three flat tabs: Service Calls, Service Contracts, Reports.

**Data model** (`lib/db.js`) — three new tables, same conventions as Stores' GIR/Gate Pass pair (§8's "As of 2026-08-19" entry) that this round's schema block sits directly after:
- `service_calls` — `project_id` is the "covered equipment" link (an order/boiler IS a project in this app; no separate equipment master exists or was invented). `priority`/`sla_hours`/`status` (open → assigned → in_progress → resolved → closed) drive the aging/SLA report; `resolved_at`/`closed_at` are stamped by the status-transition route itself (`app/api/service-calls/[id]/route.js`), never hand-entered, so they can't drift from the real status.
- `service_call_visits` — one row per site visit against a call (technician, date, notes), independent of the call's own status.
- `service_contracts` — `project_id`/`customer_name`, coverage window, `visit_frequency`, `entitlement` (free text — what's actually covered). `renewed_from_id` links a renewal to the contract it replaces; renewing never mutates the old row (`status='renewed'`), it inserts a new one — same "record what happened, don't rewrite it" idiom as `gate_inward_receipts`/`gate_passes`. Service *history* for a contract (STERP item 37) is just `service_calls` filtered to the same `project_id` — no second copy of that data.

**Routes** — `app/api/service-calls/route.js` (GET isInternal-gated, POST Installation-only), `app/api/service-calls/[id]/route.js` (field edits + status transitions, stamping `resolved_at`/`closed_at`), `app/api/service-calls/[id]/visits/route.js` (POST a visit), `app/api/service-contracts/route.js` (GET/POST), `app/api/service-contracts/[id]/route.js` (field edits, plus `action: 'renew'|'cancel'|'expire'`). Two new `action_permissions.js` keys: `installation.service_call.write`, `installation.contract.write` (alongside the pre-existing `installation.milestone.complete`).

**Reports tab** — four stacked `ReportShell`/`BarList`/`StatRow` cards (`components/ReportKit.jsx`, the same building blocks `CrmReportsWorkspace.jsx` uses — reused directly rather than extended into a third department group, since Installation's reports don't share any data or navigation with Sales/Marketing's), all computed client-side off data already fetched for the workspace, no new report-specific endpoint:
1. **Installation Milestones** — Site Installation/Commissioning milestone counts by status, delay reasons, commissioning completion rate. Reads `getInstallationMilestones()` (`lib/data.js`), `milestones` filtered to `department = 'Installation'`.
2. **Service Call Aging & SLA Compliance** — open-call count by priority, SLA compliance % (resolved/closed calls within their `sla_hours`), repeat-customer count.
3. **Technician Performance** — assigned/resolved counts and average resolution time per `assigned_to`.
4. **Service Contracts & Renewals** — active contract count, contracts expiring within 30 days, renewal rate (`renewed` / (`renewed`+`expired`+`active`)).

**Live-verified end to end** (installation_head): create a service call with a linked project (customer auto-fills from the project) → Manage it to Assigned with a technician → log a visit → all four reports render real numbers off that data. Create a service contract → Renew it (new SVC-1002 active, old SVC-1001 flips to renewed) → Contracts report shows the resulting renewal rate. No app bugs found; one 403 seen mid-testing was a shared-browser cross-session cookie collision on `localhost` (unrelated to this feature — cookies aren't port-scoped, so a concurrent session's dev server on another port can overwrite this one's session cookie), confirmed by re-authenticating and re-issuing the same request directly.

Not built, on purpose: no file/photo upload for closure evidence (`closure_evidence` is a plain text reference, same convention as `sales_returns.credit_note_ref` — no document-store system exists anywhere in this app to hang a real upload on, see §8); no SMS/email notification on SLA breach (§8, Priority 6, explicitly out of scope this round); no separate "equipment" master distinct from `projects` (would be a speculative entity with no confirmed need, same reasoning STERP already gave for deferring Sales Offices/Branches).

## 5o. Engineering — Multi-Level BOM, Where-Used, Common/Uncommon, Engineering Change Note, + Purchase Returns (2026-08-19/20, STERP items 16-19 and 13)

STERP's own note says items 16-19 are interlinked and must be designed together — Where-Used depends on Multi-Level BOM existing first. Built together as one round, plus Purchase Returns (item 13) as an independent Procurement-side track raised in the same session.

**New top-level tab** — `/engineering` (`app/engineering/page.js` → `components/EngineeringWorkspace.jsx`), gated to `canAccessDepartment(user,'Design') || canAccessDepartment(user,'Engineering')` — the one deliberately-combined gate in this whole round (everything underneath keys to the `'Engineering'` string alone, so a future Design/Engineering split only touches this one nav line, per the owner's ask). Four flat tabs: BOM Structure, Where-Used, Common/Uncommon, Change Notes. Per-project BOM *editing* stays where it already was — the project page's Engineering panel (`BomPanel`/`BomTable`) — this workspace is the cross-project oversight surface, same split Installation draws (§5n) between a project-page action and its own workspace.

**Data model** (`lib/db.js`):
- `bom_assemblies` — `project_id`, `parent_id` (nullable, self-referencing — the nesting), `name`, `qty` (multiplier). Generalizes the BOM's existing flat `section`/`group_label` text grouping into a real tree **without touching `bom_items`' leaf-row shape** — every `bom_items` row must stay a packable leaf (packing reconciliation joins `packing_items.bom_item_id -> bom_items.id`; a non-packable "container" row would break that). `bom_items.assembly_id` (nullable FK) is the only new column on the BOM itself — null keeps every existing BOM's flat behavior exactly as it was, no migration or backfill attempted. Declared Engineering-owned in `BOM_FIELD_OWNERS` (`lib/bom-fields.mjs`), so it's PATCHable through the existing `bom-items/[id]` route with no new trust-boundary code.
- `bom_change_notes` — `project_id`, `bom_item_id` (nullable), `field_changed`/`old_value`/`new_value`, `reason`, `status` (pending/approved/rejected), `requested_by`/`approved_by`, `effective_revision`. This is the "release/approval workflow for BOM revisions" §5a's v1 explicitly deferred ("Deliberately not built... release/approval workflow for BOM revisions") — now built. `effective_revision` reuses `projects.bom_release_revision` (shipped 2026-08-19, §5a) rather than inventing a second revision counter — stamped with the project's *current* value at approval time.
- `purchase_returns` — direct schema mirror of `sales_returns` (§5e): `po_id`/`po_item_id` instead of `sale_order_id`, `debit_note_ref` instead of `credit_note_ref`, `stock_action` values `none`/`removed_from_stock`/`replaced` (removed_from_stock decrements `inventory_items.on_hand` — the opposite direction of Sales Returns' credit).
- One seeded `action_permissions` row: `('Engineering','engineering.ecn.approve',1)` — the only Head-gated key in this round, inserted `INSERT OR IGNORE` since every other row in that table is admin-configured after the fact via Settings. Live-testing this exposed a **real pre-existing seed gap**: every `<dept>_head` demo account (`HEAD_USERS`, `lib/db.js`) was created with `department_roles` left NULL, which `departmentRole()` silently reads as Member tier, not Head — it never mattered before because no Engineering action had ever actually required Head tier. Fixed at the root: the `HEAD_USERS` seed loop now sets `department_roles={dept:'head'}` for fresh DBs, plus an idempotent live-DB backfill migration (`UPDATE users SET department_roles=... WHERE department_roles IS NULL`) for every already-seeded DB, this one included.

**Identity matching** (Where-Used, Common/Uncommon) — hybrid, not string-only: `bom_items.item_id` (the confirmed real catalog key — a comment on that column notes `item_code` was tried and rejected against real data, only 1 of 2,773 rows populated) when set; normalized `material_description`+`moc`+`size_spec` (`normalizeMaterial()`, inlined into the new `lib/bom-structure.mjs` rather than imported from `lib/remnant-match.js`, which drags in the whole DB client and would break plain-`node` self-checkability) as fallback. `item_id` is only set when a row is picked from catalog search — PMB bulk import, "the dominant way Design actually populates a BOM" (§5a), leaves it NULL — so an item_id row and a string-only row never cross-match even on identical text; coverage improves naturally as more lines get catalog-picked, no backfill needed.

**Sentinel-project labeling** — Where-Used/Common-Uncommon read across every project including the sentinel system project stock/sas BOM lines point at (§5c D7); reuses `ProcurementWorkspace.jsx`'s existing `projectLabel()` convention ("Stock"/"SO #...") rather than showing the sentinel's literal placeholder `project_no`.

**Pure logic split out** — `lib/bom-structure.mjs` (roll-up qty math, identity keying, the ECN approve/reject guard, the Purchase-Return stock-decrement guard) is dependency-free on purpose, same precedent as `lib/bom-fields.mjs`/`lib/pmb.mjs`: plain `node lib/bom-structure-selfcheck.mjs` runs real `assert` checks against it (roll-up multiplication through a 3-level chain, item_id-vs-string cross-match exclusion, both transition guards) without booting the app.

**ECN v1 scope, on purpose**: a logged, approvable record + a downstream-impact view (which POs/packing lines/tasks/drawing reference the changed item, all read live off existing FKs — no impact table). It does **not** yet force every post-release BOM edit through the ECN gate — that's a bigger behavior change touching every `PATCH /api/bom-items/[id]`, left as the noted upgrade path. STERP's stated requirement (reason, affected project, old/new values, approval, effective revision, downstream impact) is fully met by what shipped.

**Purchase Returns UI** — new `Returns` tab in `components/ProcurementWorkspace.jsx`, direct component mirror of `SalesWorkspace.jsx`'s `ReturnsTab`/`ReturnRow` (same dialog shape, same inline inspection-outcome/stock-action/reference-field pattern).

**Live-verified end to end** (engg_head / procurement_head): created a nested assembly (ID Fan Assembly ×2 → Drive Sub-assembly ×1), assigned a real BOM item to it from the project page, confirmed roll-up qty (200 Kgs × 2 = 400) — Multi-Level BOM. Searched Where-Used for a reused part, got results across 3 real projects plus a Stock-sourced row correctly labeled "Stock" not the sentinel placeholder. Raised an ECN on a real project's BOM item, approved it as `engg_head` (only visible/succeeds after the `department_roles` backfill above), confirmed `status=approved`, `approved_by`, `decided_at`, `effective_revision=0` all stamped correctly via direct API read. Raised a Purchase Return against a real issued PO as `procurement_head`, flipped inspection to Accepted, confirmed the row updates live.

Explicitly out of scope this round (STERP Priority 5/6, per the brief): accounting/GST integration, native mobile, automated email/SMS.

## 5p. QC — Incoming/Finished Goods/Subassembly/Job-Work Inspection + Calibration (2026-08-20, STERP Priority 4, items 30-35)

Closes out QC's remaining STERP list. All six build on `qc_records`/`QcPanel.jsx` (§5b) rather than inventing parallel entities — only Job-Work Inspection (item 33, an entity that never existed anywhere in this app) and Calibration (items 34/35, not project-scoped) got real new tables.

**`qc_records` extended, not replaced** — three nullable link columns (`bom_item_id`, `work_order_id`, `assembly_id`) plus `dispatch_eligible` (mirrors `bom_items.production_done` — a plain per-record boolean, not a new status enum). Incoming/Finished Goods/Subassembly Inspection are all just `qc_records` rows with a different `test_type` string and whichever link column applies — same whole-row QC ownership as every other test type, same `QcPanel.jsx` UI, extended with an optional link picker (`linkField`/`linkOptions` props) and a dispatch-eligibility toggle pill (`showDispatchToggle`).

- **Incoming Inspection Against PO (item 30)** — `app/api/bom-items/[id]/route.js`'s PATCH route auto-inserts a Pending `qc_records` row (`bom_item_id` set, `created_by='system'`) on the transition into `purchase_status='Received'` — same "only fire on the transition, guarded on the *prior* status" idiom the same route already uses for the Stores-notify and Cancelled-reservation-release guards just above it. QC can still add one by hand for anything the auto-suggestion misses.
- **Finished Goods Inspection (item 31)** — `work_order_id`-linked `qc_records` row (project page's QC tab, Work Order picker sourced from `getWorkOrders({projectId})`, §5l). `dispatch_eligible` is the one field Dispatch's packing flow can read — set manually by QC once satisfied, not auto-derived from `result` (a pass doesn't always mean cleared to ship; QC decides).
- **Subassembly Inspection (item 32)** — `assembly_id`-linked `qc_records` row (picker sourced from `bom_assemblies`, §5o) — the real intermediate "stage" to inspect against, not a second hierarchy.
- **Job-Work Inspection (item 33)** — new `job_work_inspections` table + `components/JobWorkPanel.jsx`: `job_worker_name`/`job_worker_contact` (free text — no vendor master, YAGNI), `sent_date`/`expected_return_date`/`sent_qty`, `received_date`/`received_qty`/`result`. Variance (`sent_qty - received_qty`) is computed live at read time (`lib/data.js`'s `getJobWorkInspections`), never stored — same "never stored" precedent as Multi-Level BOM's roll-up qty (§5o).
- **Instrument + Jigs/Fixtures Calibration (items 34/35)** — one new `calibration_items` table with a `type` column (`instrument`/`jig_fixture`) instead of two entities with an identical shape. Not project-scoped (equipment, not a project record) — lives on the QC workspace's own new **Calibration** tab (`components/QcWorkspace.jsx`, `components/CalibrationPanel.jsx`), not a project tab, `GET /api/calibration-items` `isInternal`-gated same reasoning as `/api/inventory-items`. Status (`ok`/`due_soon`/`expired`/`blocked`) is derived live from `due_date` vs. today (`due_soon` = within 30 days) — `blocked` is the one manual override, an instrument pulled out of service before its due date, and always wins over the date.

**Action Permissions** — four new keys, `qc.jobwork.write`/`.delete` and `qc.calibration.write`/`.delete`, open by default (no seeded Head-gate row) — inspection logging doesn't carry the same release-authority weight ECN approval does (§5o).

**Pure logic split out** — `lib/qc-inspections.mjs` (`jobWorkVariance`, `calibrationStatus`), dependency-free, same precedent as `lib/bom-structure.mjs`: `node lib/qc-inspections-selfcheck.mjs` runs real `assert` checks (variance math, expired/due-soon/ok/blocked transitions) without booting the app.

**Live-verified** (as `qc_head` against the real dev DB): calibration item created with a past `due_date`, confirmed `status='expired'` via direct API GET; job-work inspection created (`sent_qty=10`, `received_qty=8`), confirmed the project page renders `JobWorkPanel` (variance=2) with no error; `qc_records` row created with `test_type='Finished Goods Inspection'` and `dispatch_eligible=true` via API, confirmed the write and the project page's QC tab both render cleanly with all four new panels in place. Test rows deleted after verification.

## 5q. Accounts — Phase 0: Decisions & Foundation (2026-08-20, ACCOUNTING-IMPLEMENTATION-PLAN.md)

New department, added the same way Sales/Marketing/HR were: `DEPARTMENTS` (`lib/milestones.js`), `HEAD_USERS`/guarded one-off `accounts_head` insert (`lib/db.js`), a Nav tab (`/accounts`, `LandmarkIcon`), and a `d-login` demo entry — no milestones (same "works through its own module, not the milestone tracker" precedent as Sales/Marketing/HR).

**Architecture decision (supersedes the plan's original framing):** Shanti Ops is the system of record for the full Accounts workflow — ledger, chart of accounts, journal postings, trial balance, P&L, balance sheet, GST returns — not just the document trail. Tally is an optional sync target, not the book of record; ERPNext is out. Both readiness/plan docs were rewritten to match (ACCOUNTING-READINESS.md §7/§8, ACCOUNTING-IMPLEMENTATION-PLAN.md's architecture note + a new Phase 5 "General Ledger & Financial Statements" replacing the old Tally/ERPNext export phase, which becomes Phase 6 "Optional Tally Sync"). e-invoicing confirmed not required now, deferred. Both entities' real GSTIN/PAN/address not available — `company_settings` seeded with placeholder values, flagged in its own UI until filled in.

- **`company_settings`** — one row per legal entity (`company`, `legal_name`, `gstin`, `pan`, `registered_address`, `state`, `state_code`, `invoice_prefix`), seeded for Shanti Boilers & Pressure Vessels (P) Ltd and Shanti Techno Fab with placeholder GSTIN/PAN/address.
- **`company` column backfilled** onto `quotations`, `purchase_orders`, `po_items` (nullable, `addColumn`) — closes the readiness register's §3 gap ("even a perfectly GST-accurate PO is useless to Accounting if it can't say which company issued it"). Not yet populated per-row or exposed in those documents' own UI — that's a Phase 1+ retrofit, not Phase 0's job.
- **`components/AccountsWorkspace.jsx`** — one tab so far, Company Settings, editable per company via `PATCH /api/company-settings` (`accounts.company_settings.write`, open by default, same "no seeded Head-gate row" rule as HR's inspection-logging keys). Placeholder rows show an inline warning until GSTIN/PAN/address are filled in.

**Live-verified** (as `accounts_head` against the real dev DB, direct API calls): login returns `departments: ["Accounts"]` (confirms the generic `department_roles` backfill loop picked up the new `HEAD_USERS` entry with no code change needed); `GET /api/company-settings` returns both seeded rows; `GET /accounts` returns 200; `PATCH /api/company-settings` updates a field and is visible on the next GET. Test edit reverted after verification.

## 5r. Accounts — Phase 1: GST & TDS Rate Masters (2026-08-20, ACCOUNTING-IMPLEMENTATION-PLAN.md)

- **`gst_rates`** — HSN → rate, effective-dated (`effective_from`/`effective_to`), same versioning shape as `income_tax_slabs`. No seed rows — unlike PT/income-tax slabs there's no one universal government schedule to default to; real HSN→rate mapping depends on the company's actual products.
- **`vendor_tds_rates`** — section (194C/194J)/rate/threshold, effective-dated. Seeded with best-known current defaults (194C 1%/2%, 194J 10%, ₹30,000 threshold) — same "seed a real default, flag it as unverified" idiom as `income_tax_slabs`. Rate table only, no per-vendor cumulative threshold tracking (deferred to Phase 3, needs Vendor Bills to exist to deduct against).
- **UI** — `AccountsWorkspace.jsx`'s new "GST & TDS Rates" tab, same add-a-row-plus-list shape as `PayrollWorkspace.jsx`'s `PtSlabsCard`/`TaxSlabsCard`. `POST /api/gst-rates` / `POST /api/vendor-tds-rates`, gated by new `accounts.gst_rate.write` / `accounts.tds_rate.write` keys (open by default, same rule as every other Accounts action so far).

**Retrofit investigated and deferred:** the plan called "let Quotation/PO look up `tax_pct` from `gst_rates` by HSN" a small, recommended addition. It isn't small — `hsn_code` exists in the `quotation_items`/`po_items` schema but neither `SalesWorkspace.jsx`'s quotation form nor the PO item editor (`BomPanel.jsx`/`BomTable.jsx`) collects it anywhere today; the Quotation form takes one flat GST% for the whole document. A real retrofit needs new HSN input UI on both forms first. Both plan docs updated to reflect this as its own future phase, not bundled into Phase 1.

**Live-verified** (as `accounts_head` against the real dev DB, direct API calls): `GET /api/vendor-tds-rates` returns the three seeded 194C/194J rows; `GET /api/gst-rates` returns empty; `POST /api/gst-rates` with a real HSN (7309, pressure vessel steel) creates a row, confirmed on the next GET; `/accounts` returns 200. Test row deleted after verification (via a direct Turso HTTP API call, since there's no DELETE route yet and the dev DB is remote — see `dev-server-uses-remote-turso` in session memory).

## 5s. Accounts — Phase 2: Sales Invoice + Credit Note (2026-08-20, ACCOUNTING-IMPLEMENTATION-PLAN.md)

**Real GSTIN/PAN/address found, not missing.** Phase 0 seeded `company_settings` with placeholder
values because both were reported "not available" — turned out `lib/qc-doc-pdf.js`'s
`COMPANY_PROFILES` already carried both entities' real GSTIN and address, used on QC document PDFs
already issued to customers. Backfilled `company_settings` with the real values (PAN derived from
the GSTIN's own embedded PAN) and updated the fresh-DB seed to match — both readiness/plan docs'
Phase 0 decision 2 corrected.

- **`sales_invoices`/`sales_invoice_items`** — mirrors `quotations`/`quotation_items`'s shape
  (subtotal/tax/total, same item columns), plus `company`, a real sequential `invoice_no`
  (`<prefix>/<seq>/<FY>`, e.g. `SB/1/2026-27` — matches the real invoice-number style already seen
  in `packing_lists` demo data), `sale_order_id`/`quotation_id` links, and a genuine CGST/SGST/IGST
  split instead of one flat `tax_pct`.
- **`lib/gst-calc.mjs`** (+ `lib/gst-calc-selfcheck.mjs`) — the one real calc in this phase:
  `financialYear()` (April–March FY labeling) and `gstSplit()` (intra-state → CGST+SGST,
  inter-state or unknown customer state → IGST, never guesses intra-state on missing data).
  Dependency-free, same precedent as `lib/bom-structure.mjs`.
- **`sales_credit_notes`/`sales_credit_note_items`** — real linked document (`credit_note_no`,
  line items, amount, reason, status) that `sales_returns.credit_note_ref`'s free text can now
  point at by number. `sales_returns` itself untouched, no structural FK yet — just a real document
  to reference instead of nothing.
- **UI** — `SalesWorkspace.jsx`'s new "Invoices" tab (list + status + payment_ref, "Credit Note"
  dialog), and a "Convert to Invoice" button next to "Convert to SO" on an accepted Quotation
  (`app/api/quotations/[id]/convert-to-invoice`, same "accept → auto-create the next record"
  playbook as the existing Quotation → Sale Order convert route).
- **Action Permissions** — `sales.invoice.create`, `sales.invoice.status`, `sales.credit_note.write`
  in the `Sales` block (not `Accounts` — the plan calls for this UI to live on the Sales workspace,
  same department boundary as Quotations/Sale Orders).

**Non-goals kept:** no e-invoice/IRN fields (Phase 0 confirmed not required), no partial/
installment billing, no per-vendor TDS deduction (that's Phase 3, purchase side).

**Live-verified** (as `admin` against the real dev DB, direct API calls): created a quotation for
a customer with no `state_code` on file, accepted it, converted to invoice — confirmed IGST-only
split (missing customer state correctly falls to inter-state, never guesses intra-state), correct
`invoice_no` format and total. Marked `issued` with a `payment_ref`, confirmed on the next GET.
Created a credit note against it, confirmed it lists under `/api/sales-credit-notes` with the
right linked `invoice_no`. `/sales` page returns 200. All test rows deleted after verification (via
the Turso HTTP API, same reason as Phase 1 — no DELETE route, remote dev DB).

## 5t. Accounts — Phase 3: Vendor Bill + Debit Note (2026-08-20, ACCOUNTING-IMPLEMENTATION-PLAN.md)

Direct mirror of Phase 2 on the purchase side.

- **`vendor_bills`/`vendor_bill_items`** — `bill_no` is the *supplier's* own number (free text,
  not unique — we don't control their series, unlike our own `invoice_no`), `po_id` link, CGST/
  SGST/IGST split (`lib/gst-calc.mjs`'s `gstSplit()`, same function Phase 2 uses — direction just
  reverses: supplier's `state_code` vs the issuing company's), and Phase 1's `vendor_tds_rates`
  finally gets consumed: `tdsAmount()` deducts a flat section rate into `payable_amount`. Still no
  per-vendor cumulative threshold tracking (deliberately deferred — real stateful complexity,
  separable from getting a correct-enough bill recorded).
- **`purchase_debit_notes`/`purchase_debit_note_items`** — mirrors Phase 2's Credit Note; the real
  document `purchase_returns.debit_note_ref`'s free text can now point at by number.
  `purchase_returns` itself untouched, same "add the document, don't redesign the return flow"
  precedent as Phase 2.
- **UI** — "Record Bill" button on `PODrawer` (any `issued` PO — not gated on a per-line receipt
  status, since that lives on the linked `bom_items`, not the PO itself), a new "Vendor Bills" tab
  on `ProcurementWorkspace.jsx` with status/payment_ref and a "Debit Note" dialog. `vendor_tds_rates`
  is passed down as a page-level prop (`app/procurement/page.js`) rather than fetched client-side,
  since its own API route is gated to the `Accounts` department and Procurement heads need to read
  it here.
- **Action Permissions** — `procurement.vendor_bill.write`, `procurement.vendor_bill.status`,
  `procurement.debit_note.write` in the `Procurement` block.

**Live-verified** (as `admin` against the real dev DB, direct API calls): issued a draft PO,
recorded a bill against it — confirmed correct CGST+SGST split (supplier and company both state
code 36, intra-state). Recorded a second bill on the same PO with a 194C TDS section selected —
confirmed `tds_amount` = 1% of `total`, `payable_amount` = `total` − `tds_amount` exactly. Marked
a bill `approved` with a `payment_ref`, created a debit note against it, confirmed it lists under
`/api/purchase-debit-notes` with the right linked `bill_no`. `/procurement` returns 200. All test
rows deleted and the PO reverted to `draft` after verification (Turso HTTP API, no DELETE route,
remote dev DB — same reason as every other phase this session).

## 5u. Accounts — Phase 4: Payroll → Accounting Export (2026-08-20, ACCOUNTING-IMPLEMENTATION-PLAN.md)

The cheapest phase on the whole plan — `salary_slips` was already the best-prepared table (its
schema comment has said "ACCOUNTING INTEGRATION POINT for a future sync to read" since before this
plan started), and `employees.company` already routes it to the right entity's books.

- **`salary_slips.payroll_export_status`** — `not_exported`/`exported`/`reconciled`, defaulting
  `not_exported`. Same vocabulary Phase 6 (optional Tally sync) will reuse for every other document
  type — introduced here first since Payroll is the simplest case to prove it on.
- **UI** — the existing `SalarySlipSheet` (Payroll workspace, `PayrollWorkspace.jsx`) gets a second
  status line and a "Mark Exported"/"Mark Reconciled" button next to the existing Submit/Mark Paid
  actions; the Salary Slips list gets a matching Export column. Same `PATCH /api/salary-slips/[id]`
  route as the existing status update — HR already owns this UI, no new Accounts-facing surface for
  one field.
- **No new financial computation** — the PF/ESI/PT/TDS amounts were already correct before this
  phase (Payroll's own statutory rates predate this plan entirely).

**Live-verified** (as `admin` against the real dev DB, direct API calls): a test salary slip
defaulted to `payroll_export_status='not_exported'` with `company` correctly routed via its
employee; PATCH to `exported` then `reconciled` both persisted correctly on the next GET. `/hr`
returns 200. Test slip deleted after verification.

### Gap audit addendum (2026-08-20, after Phase 4)

While handing off a Phase 5 prompt, audited Phases 0–4 for gaps before starting Phase 5. Found and
fixed one real bug:

- **Credit/debit note number collision across companies.** `sales_credit_notes.credit_note_no` and
  `purchase_debit_notes.debit_note_no` are globally `UNIQUE`, but their sequence counters are keyed
  per-company (`credit_note_no:<company>:<fy>`) and the generated number itself
  (`CN/<seq>/<fy>`/`DN/<seq>/<fy>`) never included which company it was for. Two companies' first
  credit note (or debit note) of the same financial year both produced the identical string
  (`CN/1/2026-27`) — the second `INSERT` would throw a `UNIQUE` constraint violation the first time
  Shanti Techno Fab issued one in a year Shanti Boilers already had. Fixed in both routes
  (`app/api/sales-invoices/[id]/credit-note/route.js`,
  `app/api/vendor-bills/[id]/debit-note/route.js`) by folding the company's own `invoice_prefix`
  into the number, matching `invoice_no`'s own pattern: `SB/CN/1/2026-27` /
  `STF/DN/1/2026-27`. Live-verified by creating one of each for both companies in the same FY back
  to back — confirmed distinct numbers, no collision. Test rows deleted after.

No other correctness issues found — permission gating (`requireDepartment`/`canAccessCrm`/
`requireAction`) is consistent across every new route, no duplicate `ACTION_CATALOG` keys, and a
DB sweep confirmed no leftover test rows from any phase's verification pass.

**Known, deliberately unaddressed limitation:** neither the Quotation→Invoice convert flow nor the
PO→Vendor-Bill Record Bill flow expose a company picker in their UI — both silently default to the
derived/first company when none is passed, same limitation the pre-existing Quotation→Sale-Order
convert route already has. Not a regression from this session's work; flagging it as a known gap
rather than fixing it, since it means redesigning UI outside this plan's scope.

## 5v. Accounts — Phase 5: General Ledger & GST Compliance (2026-08-20, ACCOUNTING-IMPLEMENTATION-PLAN.md)

The first phase where "post a journal entry" and "compute a balance" are actually in scope, per
the 2026-08-20 architecture decision that Shanti Ops (not Tally/ERPNext) owns the full ledger. Two
sub-steps, both built and live-verified this session.

**Sub-step 1 — Chart of Accounts + posting engine + financial statements:**
- **`chart_of_accounts`** — per-`company`, 14 accounts seeded (Assets/Liabilities/Equity/Income/
  Expense), admin-editable. AR/AP are single control accounts (2026-08-20 decision — no
  per-customer/per-vendor sub-accounts; that detail comes from querying `journal_entry_lines` by
  source document instead). Raw Material Inventory is a real asset account — Vendor Bills debit it
  — but consumption is **not** auto-posted out of it: `material_issues` carries qty but no unit
  cost anywhere in the schema, so valuing consumption would mean inventing a costing method
  (FIFO/weighted-average) that doesn't exist yet. Flagged as a known gap, not silently skipped.
- **`journal_entries`** / **`journal_entry_lines`** — double-entry, `UNIQUE(source_type,
  source_id)` so a repeated status PATCH can't double-post. `lib/ledger.mjs` (+ selfcheck) holds
  the pure per-trigger account mapping (`salesInvoiceLines`, `vendorBillLines`,
  `salesCreditNoteLines`, `purchaseDebitNoteLines`, `salarySlipLines`) and the Trial
  Balance/P&L/Balance Sheet rollups; `lib/ledger-post.js` does the DB-touching orchestration
  (idempotent upsert-style guard, not just relying on the `UNIQUE` constraint throwing).
- **Auto-post triggers** (2026-08-20 decision: fires on issue, not a separate review step) — Sales
  Invoice `status→issued` (or a direct jump to `paid`), Vendor Bill `status→approved` (its "issued"
  equivalent) or `paid`, Credit Note / Debit Note at creation (both are created already-issued, no
  draft stage), Salary Slip `status→paid`.
- **Reports** — Trial Balance / P&L / Balance Sheet, derived read-only rollups per company per date
  range (`app/api/reports/{trial-balance,profit-loss,balance-sheet}`). Balance Sheet's equity
  figure includes net profit since inception as unclosed retained earnings — no automated
  period-close/lock exists or is planned (Phase 5's own non-goal); the report just derives it live.
- **UI** — `AccountsWorkspace.jsx`'s new "General Ledger" tab: Chart of Accounts (add-a-row), and
  the three reports, per company.

**Live-verified** (as `admin`/`accounts_head` against the real dev DB): converted a real accepted
quotation → Sales Invoice → issued it, confirmed the journal entry posted correctly (AR 41,30,000 =
Revenue 35,00,000 + GST Payable 6,30,000) and re-issuing didn't double-post; issued a Credit Note
against it (reversed Revenue/AR by the credit amount — see gstr1/ledger notes below on why credit
notes don't reverse GST separately); issued a real PO → recorded a Vendor Bill with TDS deducted →
approved it (Inventory + GST Input = AP + TDS Payable) → raised a Debit Note against it; seeded one
salary slip and marked it paid (Salary Expense = gross + employer PF/ESI share, net pay hit
Bank/Cash, every statutory deduction its own payable). Trial Balance balanced exactly
(debit=credit) after all five postings. **Demo rows left in the DB per instruction** (not cleaned
up like every prior phase's verification — this session's Salary Slip #10, Sales Invoice #4,
Vendor Bill #3, and their notes, are real persistent demo data, not test rows).

**Sub-step 2 — GST compliance (2026-08-20 terminology pass — current model, not the old
GSTR-1/2/3 model; see ACCOUNTING-READINESS.md §7 / ACCOUNTING-IMPLEMENTATION-PLAN.md Phase 5 for
the full outward/inward flow and the source note on where the terminology comes from):**
- **Outward — GSTR-1 / GSTR-1A / IFF.** One generator (`lib/gst-return.mjs`'s `gstr1Summary()`),
  fed by `lib/data.js`'s `getGstr1Lines()` (`sales_invoice_items` joined to its invoice's
  document-level CGST/SGST/IGST split, apportioned per line by taxable share — there's no per-line
  split stored anywhere). B2B (by customer GSTIN) and HSN summaries. IFF is the identical report,
  just filed monthly instead of quarterly under QRMP (`company_settings.gst_return_frequency`,
  new column, default `monthly`) — not a separate document type. GSTR-1A ("amend an already-filed
  GSTR-1") isn't modeled as its own document either — `gst_filings` is a plain "we filed this"
  marker with zero enforcement (deliberately, Phase 5's own non-goal), so an amendment is just
  re-running the same live report after that date; the portal handles the amendment mechanics.
- **Inward — GSTR-2B + IMS, replacing the old "GSTR-2" idea.** GSTR-2 was never notified as a
  filable return; `gstr2b_lines` holds the government's actual recipient-side ITC statement.
  **Intake (2026-08-20 decision): Excel/CSV upload of the portal's own GSTR-2B download is the
  normal path** (`lib/gstr2b-import.mjs`, header-anchor parser same shape as
  `lib/master-import.mjs`, built against the portal's published B2B-sheet column layout — not a
  real sample file, same caveat Phase 6's Tally-import note already carries); **manual entry/edit
  is the exception path** for individual corrections (`app/api/gstr2b` POST/PATCH), not the normal
  workflow. Each line carries `ims_status` (`pending`/`accepted`/`rejected`/`deemed_accepted`) —
  the recipient's own Invoice Management System action, actioned via PATCH (`app/api/gstr2b/[id]`).
  Re-uploading a period replaces only that period's `source='upload'` rows — manual corrections for
  the same period survive a re-upload.
- **ITC reconciliation** (`lib/gst-return.mjs`'s `itcReconciliation()`) — matches GSTR-2B lines
  against `vendor_bills` for the same period by `(supplier GSTIN, invoice number)` (no fuzzy
  amount/date matching — an unmatched pair is a manual-check exception, same as any bank-recon
  queue). Eligible ITC = lines where the portal marked `itc_availability='Yes'` **and** IMS status
  is accepted/deemed-accepted; everything else (portal says "No", or rejected in IMS) is an
  excluded amount — **not** run through a Rule 42/43 proportional-reversal calculation, a real
  additional complexity out of scope for this pass. Shanti Ops' own Vendor Bill ledger stays the
  accounting source of truth throughout — GSTR-2B/IMS is external reconciliation evidence, never a
  purchase-register replacement.
- **GSTR-3B** (`lib/gst-return.mjs`'s `gstr3bSummary()`) — the actual operative monthly return
  (GSTR-3, the full return it was meant to replace, was suspended and never revived). Nets GSTR-1's
  outward tax against ITC reconciliation's eligible ITC; negative nets show as ITC carried forward,
  not a negative payable.
- **UI** — `AccountsWorkspace.jsx`'s new "GST Returns" tab: company + month picker, GSTR-1/IFF
  summary with "Mark filed" buttons for each, GSTR-2B upload + manual-add row + accept/reject
  actions per line, ITC reconciliation summary (with an unmatched-Vendor-Bill warning), GSTR-3B net
  payable/carried-forward.
- **Explicitly not built**: e-invoicing/IRN/QR/IRP integration (Phase 0's decision stands
  unchanged — not required at the current turnover bracket); a live GST-portal/API connection for
  GSTR-2B (file upload only, per the 2026-08-20 decision); Rule 42/43 proportional ITC reversal.

**Live-verified** (as `admin` against the real dev DB): GSTR-1 report for 2026-08 correctly showed
the Himalayan Dairy invoice as IGST-only (interstate) in both B2B and HSN summary; uploaded a real
synthetic `.xlsx` GSTR-2B file (two B2B rows, one legend/total row correctly skipped) via
`POST /api/gstr2b/upload`'s preview→confirm flow; accepted one line via IMS PATCH, rejected the
other; ITC reconciliation correctly matched the accepted line to the real Vendor Bill (by invoice
number, supplier GSTIN blank on both sides) and its eligible ITC (₹8,856) matched that bill's own
GST Input Credit postings exactly; GSTR-3B net payable (₹6,21,144) = outward tax (₹6,30,000) −
eligible ITC (₹8,856); `gst_filings` POST/GET round-tripped; manual GSTR-2B add + delete worked,
and deleting an upload-sourced line was correctly refused. `/accounts`'s new "GST Returns" tab
confirmed rendering all four cards correctly in the browser. Demo rows (GSTR-2B lines, the
`gst_filings` row) left in the DB per instruction, same as sub-step 1.

## 5w. Accounts — Phase 5 completion: Manual Journals, Inventory Costing, AR/AP Settlement, Bank Reconciliation (2026-08-20, ACCOUNTING-IMPLEMENTATION-PLAN.md)

Closed the four remaining Phase 5 gaps flagged after the GST-compliance sub-step (§5v): no manual
journal entry path, no inventory consumption costing, no payment/receipt entity, no bank
reconciliation. All four reuse the existing `chart_of_accounts`/`journal_entries`/
`journal_entry_lines` ledger and posting pattern (`lib/ledger-post.js`) — no parallel system.
Inspected each area first (Stores/material-issue costing, sales_invoices/vendor_bills payment
tracking, banking) before building, per instruction — findings below.

- **Manual Journal Entry** — `journal_entries.status` (`draft`/`posted`, default `posted` so every
  pre-existing auto-posted row is unaffected) + `reversal_of_id`. `lib/ledger-post.js`:
  `createDraftJournalEntry()` / `updateDraftJournalEntry()` / `postDraftJournalEntry()` /
  `reverseJournalEntry()`; `lib/ledger.mjs`'s `reversedLines()` swaps debit/credit on every line, a
  pure transform. `app/api/journal-entries` (POST creates a draft), `[id]` (PATCH edits a draft or
  posts it, DELETE removes an unposted draft), `[id]/reverse` (POST — posted + `source_type='manual'`
  only; an auto-posted document already has its own correction mechanism, Credit/Debit Note).
  `lib/data.js`'s `getLedgerLines()` (feeds Trial Balance/P&L/Balance Sheet) now hardcodes
  `status = 'posted'` — a draft can never reach a financial statement.
- **Inventory consumption costing** — inspected first: confirmed by reading `inventory_items`/
  `material_issues`/`vendor_bill_items` and grepping for "costing"/"avg_cost"/"FIFO" that **no
  valuation method existed anywhere** (`work_order_materials.unit_cost` is a manually-typed
  planning figure for Work Order Costing, unrelated to inventory value). Weighted-average adopted
  (`lib/inventory-costing.mjs` + selfcheck) as the one method, not a second parallel system.
  `inventory_items.avg_cost` (running per-unit cost) + `vendor_bill_items.bom_item_id` (carries the
  PO line's own `bom_item_id` one hop further, additive column — `po_items` already had it) let a
  Vendor Bill line resolve `bom_items.item_id -> inventory_items.item_id`. Vendor Bill
  approval/paid (`app/api/vendor-bills/[id]/route.js`) now also receives stock into every
  resolvable line at `weightedAverageCost()`, guarded on the bill's *previous* status so a repeated
  PATCH can't double-receive. Material Issue (`app/api/material-issues/route.js`) resolves the same
  join, decrements `on_hand`, and posts Dr Material Consumed (5100) / Cr Raw Material Inventory
  (1200) at `consumptionCost()` — `material_issues.unit_cost`/`total_cost` record what was
  computed, `null` when unresolvable (never guessed). A line/issue with no traceable `item_id`
  (the common case per the readiness register's own data-quality note) simply isn't costed.
- **AR/AP settlement** — inspected first: confirmed `sales_invoices`/`vendor_bills` had only a
  `status` flag and a free-text `payment_ref`, no payment entity, no partial-payment tracking.
  Built the minimum: `customer_receipts`/`vendor_payments`, same numbered-document shape as
  `sales_credit_notes`/`purchase_debit_notes` (real per-company per-FY series via `counters`).
  `app/api/sales-invoices/[id]/receipts` / `app/api/vendor-bills/[id]/payments` (POST) post
  Bank & Cash against AR/AP (`customerReceiptLines()`/`vendorPaymentLines()`, `lib/ledger.mjs`),
  reject an amount exceeding the live balance due (summed from prior receipts/payments, not a
  stored running total — avoids sync drift), and auto-flip the parent document to `paid` once fully
  settled by a direct `UPDATE` (not the status PATCH route, so it can't re-trigger that document's
  own already-idempotent GL entry).
- **Bank reconciliation** — inspected first: confirmed no `bank_accounts` table or reconciliation
  concept exists at all; docs (ACCOUNTING-READINESS.md, ACCOUNTING-IMPLEMENTATION-PLAN.md Phase 7)
  already scope a real bank-account master as Cheque Printing's job, untouched here. Minimum
  workflow only: `journal_entry_lines.reconciled`/`reconciled_at`, a report listing every posted
  line against the Bank & Cash control account (1001) with running reconciled/unreconciled
  balances (`app/api/reports/bank-reconciliation`), and a toggle
  (`app/api/journal-entry-lines/[id]/reconcile`). No statement import, no bank-account entity —
  deliberately not a duplicate banking system.
- **UI** — `AccountsWorkspace.jsx`'s General Ledger tab gained "Manual Journal Entries" (new-entry
  dialog with dynamic account/debit/credit rows, Post/Reverse/Delete) and "AR / AP settlement"
  (pick an issued invoice or approved bill from a dropdown, enter an amount) cards; a new "Bank
  Reconciliation" tab (per-company tick-off list with balances).
- **New action-permission keys** — `accounts.journal_entry.write`/`.post`,
  `accounts.bank_reconciliation.write`, `sales.invoice.receipt.write` (Sales, mirrors
  `sales.credit_note.write`), `procurement.vendor_bill.payment.write` (Procurement, mirrors
  `procurement.debit_note.write`).
- **GST compliance (§5v) left untouched** — no live API/e-invoicing added, no Rule 42/43 work, per
  instruction.

**Verified**: `npm run build` succeeds clean. All five selfchecks pass
(`lib/ledger-selfcheck.mjs`, `lib/gst-return-selfcheck.mjs`, `lib/gstr2b-import-selfcheck.mjs`,
`lib/inventory-costing-selfcheck.mjs`). Live, against the real dev DB (as `admin`): an unbalanced
manual JE was rejected; a balanced draft didn't move the Trial Balance until posted (+10,000/+10,000
exactly); a posted entry rejected a direct edit ("immutable — use reverse"); reversing it restored
the Bank & Cash balance to its pre-JE figure while both gross totals grew by the same 10,000 (a real
reversal, not a delete); re-posting or re-reversing an already-settled entry was rejected. Linked a
real PO item to a new test catalog item + inventory row, recorded and approved a Vendor Bill against
it (`on_hand` 0→120, `avg_cost` 0→410, first receipt = its own unit cost), then issued 20 units
(`on_hand`→100, cost 20×410=8,200 posted to Material Consumed/Inventory) — Trial Balance balanced
exactly throughout (4,432,737=4,432,737). Recorded a partial then full customer receipt against a
real Sales Invoice (over-payment correctly rejected, invoice auto-flipped to `paid` on full
settlement) and a full vendor payment against a real Vendor Bill (same auto-flip). Bank
reconciliation report listed every one of the session's Bank & Cash postings correctly; toggling one
line's `reconciled` flag moved it between the reconciled/unreconciled running balances correctly.
Trial Balance, P&L, and Balance Sheet cross-checked consistent after all of the above (Assets =
Liabilities + Equity held exactly). Confirmed all four new UI sections (Manual Journal Entries,
AR/AP settlement, Bank Reconciliation, updated Chart of Accounts) render correctly in the browser.
**Demo/test rows left in the DB** (the JE + its reversal, the receipts/payments, the test catalog
item and inventory row, the material issue) — not cleaned up, per this session's now-established
"keep demo data" precedent (§5v).

## 5x. Report Engine — shared PDF frame + catalog-driven "Reports" tab, 23 documents (2026-08-22, REPORT-ENGINE-PLAN.md)

Built the reusable reporting layer REPORT-ENGINE-PLAN.md proposed, deliberately smaller than that
doc's original config-DSL idea (see the plan's own §0/§5 — the 9 pre-existing PDFs aren't
tabular-generic enough for one generic template to render them all).

- **Shared frame** — `lib/report-pdf.js`: uniform identity header (company/GSTIN + title), uniform
  footer (page X of Y, timestamp), a `<ReportTable>` primitive whose header row repeats on every
  page (none of the pre-existing PDFs needed this — none spanned more than a page or two; report
  tables regularly do), streamed (`renderToStream`) not buffered. `lib/company-profiles.js` split
  out of `lib/qc-doc-pdf.js` (pure data, no JSX) so the frame and its selfcheck run under plain
  `node`, not just Next's transformed runtime.
- **Catalog** — `lib/reports/catalog.js`: one entry per report — `compute` is the exact function the
  report's own JSON route already imports (ground rule: one computed result, three renderers, never
  three calculations, enforced by construction). `toTable`/`totals` are small hand-written functions
  per report, not a generic mapper — result shapes differ too much (Trial Balance is flat
  `{accounts, totals}`, GSTR-1 is two separate tables matching the GST portal's own B2B/HSN split,
  GSTR-3B is pure totals with no table at all).
- **Nav** — `app/reports/page.js` + `components/ReportsWorkspace.jsx`: a department only gets a
  "Reports" tab if it has ≥1 catalog entry (`REPORT_DEPARTMENTS`, computed server-side in
  `app/layout.js`, passed into `components/Nav.jsx` as a prop — the catalog pulls in server-only DB
  code and can't be imported client-side).
- **19 catalog reports**: Accounts (Trial Balance, Customer/Vendor Ledger, P&L, Balance Sheet,
  GSTR-1/3B, ITC Reconciliation, AR/AP Aging, Cash/Bank Book, Journal Register, Bank Reconciliation
  Statement), Stores (Stock Valuation/Aging/Ledger), Procurement (Purchase Register), Sales (Sales
  Register), Production (Material Consumption Report). Plus **4 per-record PDFs** outside the
  catalog — Project/Work Order Costing, Sales Invoice, Vendor Bill — reached from their own
  record's page (like the existing BOM/PO PDF pattern), not picked off a Reports-tab list.
- **Shared math, not copies** — `lib/ledger.mjs`'s `customerLedger()` generalized to
  `runningLedger()` once Vendor Ledger/Cash Book/Stock Ledger needed the identical running-balance
  rollup (quantity instead of money for Stock Ledger — same math); a new `agingBuckets()` shared by
  Receivables/Payables/Inventory Aging.
- **Migrated onto the shared frame**: `lib/bom-pdf.js`, `lib/packing-pdf.js`, `lib/payslip-pdf.js`.
  **Left untouched, as planned**: `lib/po-pdf.js`, `lib/qc-doc-pdf.js`, `lib/qc-folder-pdf.js` —
  statutory/sample-matched, migrate only once re-verified against the real sample.
- **Bugs found and fixed while verifying, not shipped silently**: seeded sales invoices missing
  their GST split (`cgst/sgst/igst_amount` left at schema-default 0 despite a real `tax_amount`) —
  fixed the seed script (`scripts/seed-sales-marketing-demo.mjs`) and the two live rows; same-day
  ledger rows sorting alphabetically by document kind instead of business precedence (a credit note
  before its own invoice, a stock issue before the receipt that stocked it) — fixed with an explicit
  `sort_rank` column (SQLite forbids a `CASE` expression directly in a compound/`UNION ALL` query's
  `ORDER BY`); the generic PDF export route wasn't forwarding `supplier_id`/`item_id` to
  `compute()`, caught live when Vendor Ledger's PDF button 400'd.
- **Excel deliberately deferred** — `xlsx` (already installed) is the free SheetJS build, no cell
  styling; `lib/reports/render.js`'s `toTable()` split means adding it later is a second consumer of
  already-shaped data, not a rewrite.

**Verified**: both selfchecks pass (`lib/ledger-selfcheck.mjs`, `lib/report-pdf-selfcheck.mjs` —
the latter asserts a real multi-page PDF whose repeating table header actually repeats). All 19
catalog reports + 4 per-record PDFs checked screen-JSON-PDF against real data on the dev DB (not
just code review) — numbers cross-checked to agree exactly per report (e.g. Trial Balance's PDF
total matched its screen card and JSON route bit-for-bit). Additive seed data added for thin
Procurement tables (`scripts/seed-report-demo-extra.mjs`, kept per instruction — useful for demo).
See `REPORT-ENGINE-PLAN.md` §0 for the full build log and `REPORT-ENGINE-MATURITY.md` for what's
left before this reads as fully mature (Excel, report-access audit logging) plus what shipped since
in the addendum below.

### Visual polish pass + Management Report + Production's 6 reports (2026-08-22 addendum)

- **§2 polish, 6 of 7 items shipped**: right-aligned numeric columns (`<ReportTable>` cols take an
  optional 4th `align: 'right'` tuple element), `Rs. ` currency prefix (not `₹` — react-pdf's
  default Helvetica is a base-14 PDF font with no glyph for U+20B9; it silently rendered as a stray
  superscript digit, only caught by reading an actual rendered PDF), parenthesized negatives, a
  "Generated by {username}" footer line, an empty-state fallback ("No data for this period."), and
  landscape orientation for the widest existing reports (GSTR-1, ITC Reconciliation, Purchase/Sales
  Register). Page-break control at section boundaries stayed unbuilt (minor, long-document-only).
- **Management Report** (`REPORT-ENGINE-MATURITY.md` §1.2's composite) — one page of headline
  numbers (Liquidity, P&L MTD/FY-to-date, Balance Sheet), per-company, built entirely from
  `compute()` functions the existing catalog reports already call. Its own top-level nav tab
  (`/executive/reports`, "Management Report") rather than a `/reports?dept=` catalog entry —
  `components/Nav.jsx`'s `isDeptPM` check deliberately excludes the `executive` role from
  per-department Reports tabs, so this needed a different path to reach that audience.
  `<ReportTotals>` (built for a 2-3-pair closing line) silently collapsed spacing under this doc's
  4 long pairs — fixed with a dedicated `StatGrid` local to the render file, plus hardening
  `ReportTotals` itself for any future long line.
- **Production's Reports sidebar, 1 entry → 7** (`REPORT-ENGINE-MATURITY.md` §1.4) — Work Order
  Register, Production Cost Variance, Rework/Rejection Report, Material Utilization Report, Labour
  Utilization Report, Material Shortage/Demand, all off existing Work Order/Job Card/`stock_pieces`
  data, no schema change. Two real bugs caught live: a wrong inventory column name, and a logic bug
  where an offcut piece (born already `status='consumed'`) was double-counted as its own phantom
  cut event — fixed by requiring the source row to actually have children (`EXISTS ... parent_id`).
  Verified against §5k's own documented demo scenario, numbers matched exactly.
- **Not started, flagged for later**: Design and QC still have zero catalog reports/no Reports tab;
  `/executive/reports` is a single card, not a sidebar — fine for one report, needs to graduate once
  more cross-department Management reports (§7's ~10-item list) get built.

### Design's Reports gap + executive sidebar graduation (2026-08-22, same-day follow-up)

- **Design's Reports tab, 0 entries → 2** — Drawing Register (`calc_drawings` across projects:
  status/assignee/due date, overdue flag) and ECN Register (`bom_change_notes`: field/old→new/
  reason/status/who requested-approved), both `department: 'Design'`, off existing tables, no
  schema change. QC's equivalent gap (QC Inspection Summary, Calibration Due/Status, Job-Work
  Inspection Register — all real candidates, all scoped, off existing data) deliberately deferred,
  not started — the user's own call, tracked in `REPORT-ENGINE-MATURITY.md` §1.9.
- **`/executive/reports` graduated to a sidebar** — `components/executive/
  ExecutiveReportsWorkspace.jsx` wraps the Management Report in the same `WorkspaceSidebar` every
  department Reports tab already uses. Structural fix ahead of content (still just the one report),
  matching the plan flagged in the same-day addendum above — the next cross-department Management
  report is now a one-line addition to this file's `ITEMS`/`SCREEN` maps, not a rewrite.
- **Verified live**: both new reports' JSON routes and PDF exports return 200 with real seeded data
  (a real approved ECN — "ISA 50X50X5 -> ISA 65X65X6, customer requested heavier angle section" —
  and real drawings across not_started/in_progress/under_review/approved); `/reports?dept=Design`
  renders both in the sidebar; `/executive/reports` still renders the Management Report correctly
  through the new sidebar shell.
- **A third `₹`-class glyph bug, caught the same way**: ECN Register's "Old → New" column used a
  `→` arrow — react-pdf's base-14 Helvetica has no glyph for that either, silently rendering as a
  stray apostrophe in the actual PDF. Fixed with plain `->`. Swept the rest of the render/PDF code
  for other non-ASCII characters (arrows, checkmarks, bullets) and found none remaining — worth
  treating as a standing risk for this font setup, not a one-off.

### Four Management reports + Working Capital tile (2026-08-22, same-day follow-up)

`/executive/reports` goes from 1 entry to 5, all `requirePM`-gated (director-altitude, not
department reports), all off existing compute functions — no new ledger math:
- **Project Profitability** — loops `getProjectCosting()` (material+labor vs. selling value,
  already built for the per-project Costing view, §5e) across every project in a period.
- **Customer Profitability** — same data grouped by customer instead of project.
- **Procurement Spend** — `getPurchaseRegisterLines()` grouped by supplier; no new SQL.
- **Manufacturing Performance Summary** — the headline for the shop floor (WO throughput,
  rejection rate, material yield, cost variance), built entirely from the four Production
  department reports' own data functions above — same "headline vs. ledger" relationship the
  Management Report has to Trial Balance/P&L. Deliberately excludes OEE/machine downtime — no
  data exists for it (§8's own gap).
- **Working Capital** (Cash + AR + Inventory − AP) added as a tile to the existing Management
  Report rather than a new sidebar entry for one number.
- **`StatGrid`** (the Management Report's fixed-width stat-tile grid) promoted from
  `lib/reports/management-report-pdf.js` into the shared `lib/report-pdf.js` once Manufacturing
  Performance Summary needed the same shape — same "promote once genuinely reused twice"
  precedent the original Report Engine build used for `runningLedger()`/`agingBuckets()`.
- **Verified live**: all 5 JSON routes and PDF exports return 200; Working Capital's math checked
  exact (cash + AR + inventory − AP); Manufacturing Performance Summary's material yield (91%) and
  QC failure count (1) matched Production's own department reports bit-for-bit, confirming the
  reuse is genuine, not a second calculation that happens to agree today.
- **Honest limitation flagged, not hidden**: Project/Customer Profitability read as ~100% margin
  for nearly every project on this dev DB — `getProjectCosting()`'s cost inputs (issued POs,
  logged job-card time) are largely empty here, so the report is accurately surfacing thin
  cost-tracking data, not computing something wrong.
- **Deliberately skipped**: Order Profitability (near-duplicate of Project Profitability — a
  project *is* its Sale Order here) and a separate "Company Performance Report" (no clearer
  definition than the Management Report already gives).

### Manufacturing Performance Summary filled out + Open PO Aging (2026-08-22, same-day follow-up)

- Nav tab renamed "Management Report" → "Reports" (matches the department Reports tabs' own label).
- **Two real oversights fixed in Manufacturing Performance Summary**: `qcFailures` and labour data
  were computed but never rendered. Now real tiles (QC Failures; Labour Hours/Cost, reusing
  `getLabourUtilizationLines()`), plus a new **Material Lines Blocking Production (30d)** tile off
  the Material Shortage report's forecast data.
- **Open PO Aging — new Procurement department report** (`lib/data.js`'s `getOpenPoAgingLines()`):
  issued POs with ≥1 line still `TRANSIT`, aged by days since `issued_at`. Neither Purchase
  Register (bill-based) nor Procurement Spend (financial roll-up) answers "what's stuck in the
  pipeline right now" — this does, off data already captured. Distinct from the blocked Supplier
  Performance metric (needs a *promised* date, inconsistently populated) — this only needs
  *issued* date.
- **Research pass against this file (§5c/§5e/§8) to answer "what else is obviously missing for a
  mature manufacturing reporting layer"** — conclusion: §8's own "Production's next layer" list
  (scheduling, formal NCR, heat/lot traceability, welding traceability, subcontract cost, OEE) is a
  **capture gap, not a report gap** — the section explicitly says none of that data is recorded yet.
  No report can surface a number that was never captured; building any of it means building the
  capture UI first, a separate scope decision, correctly not attempted here.
- **A transient dev-server glitch, not a bug**: `/reports?dept=Procurement` 500'd once with
  `Cannot read properties of null (reading 'useContext')` — the same first-compile HMR error seen
  earlier this session; an immediate retry returned 200 with both reports rendering correctly.

## 5y. Statutory-rates-hub sync + TDS master fix (2026-08-22)

New sibling repo `~/Developer/statutory-rates-hub` (Next.js + `@libsql/client`, not part of this
repo) — a central, human-verified registry of Indian statutory rates (GST/TDS/PF/ESI/income-tax/PT
slabs), built multi-tenant from day one (per-tenant API keys) since a second real deployment is
expected and retrofitting tenant auth later is worse than building it in now. One generic
`rate_changes` table (category + JSON payload + effective dates), draft → approve (`approved_at`
timestamp, not a status machine) → tenant pull via `GET /api/rates/since?cursor=`. Deliberately not
built: any scraper/change-detection against government sites — no reliable free official GST/TDS
API exists (checked live), and getting a compliance number wrong unattended is worse than a human
checking around known trigger dates (Budget, GST Council meetings). See its own README.md.

**This repo's side** — `lib/rate-sync.js` (`syncRatesFromHub()`) + `app/api/statutory-rates/sync`
(POST, `x-sync-key` header auth since a cron has no session — added to `middleware.js`'s
`PUBLIC_PATHS`-adjacent exception list) + `hub_sync_state` single-row cursor table. Reuses the exact
insert/patch functions the admin routes already used — `insertGstRate`/`insertVendorTdsRate`
(`lib/data.js`), `insertIncomeTaxSlab`/`insertProfessionalTaxSlab` (`lib/data.js`),
`patchStatutoryRates` (`lib/payroll.js`) — extracted from what was inline SQL in each POST/PATCH
route so a rate entered by hand and one pulled from the hub go through identical validation.
`STATUTORY_RATES_HUB_URL`/`STATUTORY_RATES_HUB_API_KEY`/`RATE_SYNC_KEY` env vars. **Update
(2026-08-22, same day):** hub repo pushed to `github.com/clickcatalyst-digital/statutory-rates-hub`,
wired to its own real Turso DB (migrated clean, confirmed empty), a "Shanti Ops" tenant row created
there and its API key set as `STATUTORY_RATES_HUB_API_KEY` in this repo's `.env.local`.
**Update (2026-08-22, later same day):** hub deployed to Render
(`statutory-rates-hub.onrender.com`), `STATUTORY_RATES_HUB_URL` set for real. Full pipeline now
live-verified end to end: `POST /api/statutory-rates/sync` against the real deployed hub returned
`{pulled:0, applied:0, cursor:0}` — correct, since nothing's been approved in the hub yet. Caught and
fixed a real bug along the way: adding `.env.local` auto-loading to the hub's `lib/db.js` (so plain
`node scripts/*.mjs` runs pick up Turso creds, not just Next's own runtime) briefly broke
`selfcheck`'s local-file isolation, and it wrote one fake test row into the real Turso DB before
this was caught and fixed (`DB_PATH` now always wins over `TURSO_URL` when set) — deleted the stray
row, confirmed `rate_changes: 0` on Turso afterward.

**Live-verified**: hub side fully — `npm run selfcheck` (draft→approve→pull→no duplicate pull) plus
a real browser round-trip (login as admin, save draft, approve, confirm `GET /rates/since` returns
it) against the hub's own dev DB. This repo's insert functions verified for real: two missing
**194I (rent)** TDS rows — land/building/furniture 10%, plant/machinery/equipment 2%, both
threshold ₹2,40,000/yr — added through the actual `accounts_head` login + `AccountsWorkspace.jsx`
"GST & TDS Rates" tab (found missing while auditing what's actually seeded vs. current law;
`vendor_tds_rates` previously only had 194C ×2 and 194J). This went through the real Turso prod DB,
confirmed in the UI list afterward. The `/api/statutory-rates/sync` HTTP path itself was later
fully verified too, against the real deployed hub (see §5z) — `{pulled:0, applied:0, cursor:0}`,
correct since nothing was approved in the hub yet. (Separately: a genuinely fresh local shanti-ops
DB throws `no such table: crm_notes` on boot — `migrate()` has apparently never been exercised
against a truly empty DB, everyone always points at the shared Turso instance. Orthogonal
pre-existing bug, not chased down, not this feature's fault.)

**Also found, not fixed**: `gst_rates` (HSN→rate master) was completely empty. Confirmed via
`grep` that nothing reads it in a live calculation path yet (`app/accounts/page.js` only, per §5r —
Sales Invoice/Vendor Bill GST is still manually entered per line), so this wasn't producing wrong
invoices, just an unpopulated admin table. Left empty rather than inventing HSN codes for products
I don't have a real catalog for.

## 5z. Compliance pass — audit trail, period lock, fixed assets, TDS register, RCM (2026-08-22)

Prompted by an honest compliance tally (below) that found real gaps against Companies Act /
Income Tax Act requirements. **Correction made along the way**: an earlier claim that this app had
"no audit trail" was wrong — `usb_audit` already is one (215 call sites at the time, see §10's
"system-wide audit trail" note — 229 as of §5ai, keeps growing with every new mutation route, not
re-counted at every section); the real gaps were narrower.

**Built this pass:**
- **Rate-master audit logging** — the 5 rate-master routes (`gst-rates`, `vendor-tds-rates`,
  `income-tax-slabs`, `professional-tax-slabs`, `statutory-rates`) now call `audit()` like almost
  every other mutation route already did.
- **Audit Log viewer** — `AccountsWorkspace.jsx`'s new tab, `GET /api/audit-log` (search by
  action/actor/detail, latest 200 default). `usb_audit` had 215 writers and zero readers before
  this; first UI onto it.
- **Books lock** — `company_period_locks` (one row per company). Enforced at the single choke
  point every journal posting funnels through (`lib/ledger-post.js`'s `insertEntryWithLines()` +
  `postDraftJournalEntry()`), so auto-posted documents, manual journals, reversals, fixed-asset
  purchases, and depreciation runs are all covered by one check, not five. Drafts are exempt (they
  don't touch the ledger). `lib/period-lock.js`, `app/api/company-period-lock`. **Currently set to
  2020-01-01 on Shanti Boilers from live-verification testing — this is a placeholder, not a real
  close date. Move it to the actual last-closed period before relying on it.**
- **Fixed Assets + Schedule II depreciation** — `fixed_assets`, `depreciation_runs`,
  `depreciation_run_lines` tables; `lib/depreciation.mjs` (pure SLM/WDV math, own selfcheck,
  `scripts/depreciation-selfcheck.mjs`, monthly granularity only — no day-proration, see its own
  `ponytail:` comment); `lib/fixed-assets.js` (DB orchestration, mirrors `lib/ledger-post.js`'s
  split). New chart-of-accounts codes 1400/1410/5300 (Fixed Assets / Accumulated Depreciation /
  Depreciation Expense) — backfilled onto both existing companies (new codes added to
  `DEFAULT_CHART_OF_ACCOUNTS` after the one-time seed need this `else` backfill branch in
  `lib/db.js`; a brand-new company today only gets created by editing `lib/db.js` directly, no API
  route exists for that, so this is the only backfill path that matters right now). New "Fixed
  Assets" tab. **Update (§5aa, same day)**: disposal — genuinely not built when this paragraph was
  first written — is now built; see §5aa for the gain/loss-on-disposal posting and why there's
  still no "edit" flow.
- **TDS Deduction Register** — new report (`getTdsDeductionRegisterLines()` in `lib/data.js`,
  wired into the existing catalog same as every other report). Gives you what's already been
  deducted, grouped by FY/quarter/section/PAN, for handing to whoever files the quarterly 26Q —
  **does not generate the TRACES-format return itself**, no API exists for that, it's normally a
  CA/return-prep-software task.
- **RCM (reverse charge) on Vendor Bills** — new checkbox on Record Bill; when set, GST isn't
  added to what's owed the vendor and is instead self-assessed (`GST_OUTPUT_PAYABLE` credited
  alongside the usual `GST_INPUT_CREDIT` debit — `lib/ledger.mjs`'s `vendorBillLines()`). **Update
  (§5aa, same day)**: sales-side RCM is now built too — see §5aa. "Only wired on the purchase side"
  below was true when written, corrected here so it isn't read as still-true.

**Explicitly not built, and why:**
- **E-way bill generation** — real gap if you dispatch goods above the state threshold (usually
  ₹50,000/consignment). No simple government API; would go through a paid GSP
  (ClearTax/Cygnet/Vayana-style), not a direct integration.
- **E-invoicing / IRN** — only matters if turnover crosses the mandatory threshold (confirm with
  your CA). Same GSP-mediated story as e-way bill if it does apply.
- **TCS (Section 206C(1H))** — needs the same cumulative per-customer threshold tracking that
  vendor TDS deliberately doesn't have yet (§5r) — building it without that tracking would be
  wrong, not just incomplete.
- **Rule 42/43 proportional ITC reversal** — real accounting nuance, matters if you have exempt
  supplies; deferred since §5v, still deferred.
- **Live GST portal API / automated filing** — deliberate standing decision (§5v/§7): GSTR-2B
  comes in via manual upload same as the GST portal's own export flow; actual filing stays manual.

**Live-verified**: rate-master audit logging + viewer (real data, 814 pre-existing rows read back
correctly), books lock (locked Shanti Boilers, confirmed a backdated draft still creates but
posting it is rejected with the right message, cleaned up the test entry), fixed assets tab
renders (caught and fixed a real bug — missing `Select` import crashed the tab), zero-asset
depreciation run completes cleanly with no bogus posting. **Not live-verified**: TDS Deduction
Register (code-reviewed only, reuses the already-proven report-engine pattern) and RCM's actual
journal posting (verified the math balances by hand, not clicked through a real PO→bill→approve
cycle — didn't want to fabricate a fake vendor transaction in the real books). **Update (§5ai,
2026-08-23)**: that real cycle was run — as a disposable, deleted-afterward test, not a standing
verification — and it found two real bugs the hand-verified math had missed; both fixed. RCM is
still not considered "closed" until a genuine business RCM transaction happens, per instruction.

## 5aa. TDS Section 393 modernization + fixed-asset disposal + RCM sales-side (2026-08-22)

Prompted by a second AI's critique of §5z, independently fact-checked via web search before acting
on it (not taken on faith) — two of its three concrete claims held up, one was overstated.

**Confirmed and acted on**: the Income Tax Act 2025 replaces TDS sections 194C/194J/194I (and most
of the old 194-series) with a single consolidated Section 393, effective for any transaction dated
on/after 2026-04-01 — which is now, not a future concern (today is 2026-08-22, FY2026-27 already
underway). The 5 `vendor_tds_rates` rows added in §5r/§5y all cited the now-superseded law for
their own effective period.

**Overstated, not acted on**: the critique said official e-invoice/e-way bill APIs exist directly
from government-linked IRPs/NIC, not only via paid GSPs — true, confirmed by search, but production
access still needs GSTIN-based registration as an Intermediary/API integrator, not casual
self-service. Doesn't change anything in the code; noted for the user's own research.

**Built:**
- **TDS section fix** — `vendor_tds_rates.legacy_section` column (the old 194-series label, kept
  for human recognition); `section` now holds the correct Section 393 table reference (194C →
  `393(1) Sl.6(i).D(a)/(b)`, 194J → `393(1) Sl.6(iii).D(a)`, 194I → `393(1) Sl.2(ii).D(a)/(b)`).
  One-time idempotent migration `migrateTdsSection393()` (`lib/db.js`, `system_migrations`-guarded,
  same idiom as `migrateScopeOfSupplyToDocumentShape`/`migrateCalcProjectHierarchy`) rewrote the 5
  existing rows, disambiguating 194C/194I's two sub-rates by matching keywords in `description`.
  Confirmed safe first: `vendor_bills.tds_section` is a frozen text snapshot at bill-recording time,
  no FK to this table, so correcting the rate master couldn't disturb the one existing bill that
  already snapshotted `"194C"`. Seed data for a fresh install updated to match. Display updated in
  `AccountsWorkspace.jsx`'s TDS card and `ProcurementWorkspace.jsx`'s Record Bill dropdown — both
  show `section` with `(formerly {legacy_section})` when present. The TDS Deduction Register (§5z)
  needed no change — it reads bills' own frozen snapshot, which is inherently correct for whatever
  was true when each bill was recorded.
- **Fixed asset disposal** — `lib/ledger.mjs`'s `fixedAssetDisposalLines()` (standard disposal
  entry: clear cost and accumulated depreciation, record what came in, plug the difference as
  gain/loss into new account `4200` "Gain/Loss on Asset Disposal" — income-type, nets negative for
  a loss, same convention as Accumulated Depreciation). `lib/fixed-assets.js`'s
  `disposeFixedAsset()`, `POST /api/fixed-assets/[id]/dispose`, a Dispose button + inline form per
  asset in `AccountsWorkspace.jsx` (disposed assets move to a struck-through section, not deleted).
  Deliberately no "edit a fixed asset" flow — matches this app's existing principle that a posted
  entry is corrected with a new document, never mutated in place; disposing a mis-entered asset at
  ₹0 **is** the correction mechanism.
- **RCM on Sales Invoices** — `salesInvoiceLines()` gained an `isReverseCharge` param: under
  outward-supply RCM the supplier neither collects nor remits any GST at all (unlike purchase-side
  RCM, which still claims Input Credit), so it's just AR/Revenue for the taxable value, no
  `GST_OUTPUT_PAYABLE` line. `sales_invoices.is_reverse_charge` column, wired through
  `convert-to-invoice` and the issue-time posting in `sales-invoices/[id]/route.js`. UI: a small
  confirm dialog now sits in front of Quotations' one-click "Convert to Invoice" button in
  `SalesWorkspace.jsx` (there wasn't one before) with the RCM checkbox.

**Live-verified**: the TDS migration, against the real Turso DB — all 5 rows show the correct
Section 393 reference + `(formerly 194X)` label, disambiguation matched correctly (194C's
individual/HUF vs others sub-rate, 194I's plant/machinery vs land/building sub-rate), and it proved
idempotent in practice (the dev server restarted once mid-session, `migrate()` ran twice, labels
stayed correct — not double-mangled). The RCM confirm dialog on Sales renders correctly against a
real accepted quotation, closed without submitting (didn't want to force-create a real invoice as a
side effect of a UI check). Fixed Assets tab still renders with the new Dispose button present in
code, but there's no real asset yet to click it against, so that's a render-only check, not exercised
(superseded — a real asset was created and disposed later, see §5ac/§5ad, so this render-only caveat
no longer applies to Fixed Assets; it's quoted here only for the RCM-on-Sales sentence above, which
is still accurate as of §5ai — sales-side RCM remains code-reviewed only, never a real invoice).
All of `vendorBillLines`/`salesInvoiceLines`/`fixedAssetDisposalLines`'s new branches (RCM both
sides, disposal gain, disposal loss, exact-book-value no-op, ₹0 mistake-correction) verified by a
new `scripts/ledger-selfcheck.mjs` — pure-function checks, no DB, no fake data ever written anywhere
— chosen specifically so "live verification" didn't mean planting a fabricated real transaction in
the books to prove the math.

## 5ab. Bank reconciliation — statement import + auto-match (2026-08-22, ACCOUNTING-IMPLEMENTATION-PLAN.md Phase 8)

Extends the manual Bank & Cash tick-off (§5w) with statement import and auto-matching — it does
not replace it, anything not confidently auto-matched still falls back to the existing per-line
`reconciled` toggle.

**Design decisions (confirmed with user before building, per the plan's own rule):** multi-bank
support from the start (not a single hardcoded format); match tolerance is exact amount within a
few days (±3 default) rather than same-day-only, for real clearing lag; a match auto-reconciles
only when **mutually unique** (exactly one eligible candidate on each side within tolerance) —
ambiguous candidates always fall to manual review, never guessed; an unmatched statement row (a
bank charge or interest never recorded) gets a one-click quick-create journal entry rather than
staying a dead-end list item.

**Built:**
- **`lib/bank-match.mjs`** — pure matching function, no DB. Normalizes both sides to a signed net
  amount (ledger: debit − credit; statement: deposit − withdrawal) and only considers
  already-**unreconciled** ledger lines as candidates. `confidence: 'high'` requires mutual
  uniqueness within the date window; everything else surfaces as `'low'` (closest-by-date
  suggestion) for a manual click, never auto-reconciled. Own selfcheck,
  `scripts/bank-match-selfcheck.mjs` — 8 pure assertions (exact match, in-window match,
  out-of-window miss, sign mismatch, ambiguous-candidates stays low, unmatched statement row,
  unmatched ledger line, an already-reconciled line is never a candidate) — all pass.
- **`lib/bank-statement-import.mjs`** — same header-anchor parsing shape as
  `lib/gstr2b-import.mjs`/`lib/master-import.mjs` (`xlsx`, already a dep). A header-alias registry
  (not N hardcoded per-bank parsers) covers common Indian netbanking CSV column shapes — separate
  Withdrawal/Deposit columns, a single signed Amount, or Amount + Dr/Cr indicator — collapsed to one
  signed `amount` field matching the matcher's ledger-sign convention. Date parsing covers
  `DD/MM/YYYY`, `DD-MM-YYYY`, `DD-Mon-YYYY`, and ISO. **Marked with a `ponytail:` comment naming the
  real ceiling: the header-alias map is a reasonable superset, not verified against any actual bank
  export yet** — smoke-tested only against a synthetic CSV built by hand, confirmed the header
  detection, date normalization, and amount-sign collapsing all work end-to-end on that synthetic
  file. `node lib/bank-statement-import.mjs <file>` dumps detected columns/sample rows, the intended
  first step against a real file per bank.
- **`POST /api/reports/bank-reconciliation/import`** — two-phase (preview, then `confirm=1`), same
  shape as `app/api/gstr2b/upload/route.js`. Preview parses + matches against the real dev DB's
  current unreconciled Bank & Cash lines and returns high/low/unmatched groups, nothing written.
  Confirm reconciles every high-confidence line and audits it. Deliberately **stateless** — raw
  statement rows are never persisted; re-importing just re-matches against current ledger state
  (already-reconciled lines drop out of the candidate pool, so no double-reconcile risk). `ponytail:`
  comment naming the upgrade path (an import-history table) if that's ever actually needed.
- **`POST /api/reports/bank-reconciliation/quick-je`** — for an unmatched statement row, posts a
  2-line Bank & Cash vs. chosen-counter-account entry via the existing manual-JE engine
  (`createDraftJournalEntry`/`postDraftJournalEntry`, `lib/ledger-post.js` — already
  period-lock-aware, no new posting logic written) and marks the new Bank & Cash line reconciled.
  New `5400` Bank Charges expense account added to `DEFAULT_CHART_OF_ACCOUNTS`
  (`lib/ledger.mjs`) as the dropdown's default, backfilling onto both existing companies via the
  same `else` branch §5z's Fixed Assets codes used (`lib/db.js` — codes added to
  `DEFAULT_CHART_OF_ACCOUNTS` after the one-time seed self-backfill on next `migrate()`).
- **UI** — `AccountsWorkspace.jsx`'s Bank Reconciliation tab gained an "Import Statement" card above
  the existing tick-off list: upload → preview dialog (auto-matched / needs-review with a
  per-line Reconcile button / unmatched-statement rows each with an inline quick-JE form) →
  "Confirm & reconcile" for the auto-matched group. Reuses the existing per-line reconcile toggle
  and chart-of-accounts fetch already on the tab.
- **Reused `accounts.bank_reconciliation.write`** for both new routes — same permission gate as the
  existing manual toggle, since this is the same workflow, not a new one. No new
  `ACTION_CATALOG` entry.
- **Also updated `ACCOUNTING-IMPLEMENTATION-PLAN.md` Phase 10** with two research corrections
  surfaced while scoping this phase (a second AI's e-invoice/e-way-bill research, independently
  checked): at least one IRP (IRIS) publishes onboarding APIs aimed at solution providers/ERP
  vendors, and e-way-bill direct-API eligibility is volume-based (~1,000/day or ~10,000/month per
  GSTIN), not industry-restricted as previously assumed. Neither changes the phase's deferred
  status — no real trigger (turnover/volume threshold) has fired — and neither belongs in
  `statutory-rates-hub`: any future connector's credentials/state are inherently per-company
  transactional data, which is Shanti Ops' job, not the hub's (the hub only ever distributes
  identical-for-everyone rate data, no per-tenant secrets).

**Verified**: `npm run build` succeeds clean, including the two new routes.
`scripts/bank-match-selfcheck.mjs` (8 assertions) and every pre-existing selfcheck
(`lib/ledger-selfcheck.mjs`, `lib/depreciation-selfcheck.mjs`, etc.) still pass. The parser was
smoke-tested against a synthetic CSV (not a real bank export) — header detection, multi-format date
parsing, and deposit/withdrawal-to-signed-amount collapsing all worked correctly on it.

**Live-verified against the real dev DB (2026-08-23, follow-up pass)** — the plumbing this feature
depends on, distinct from the parser's header-alias mapping (still open, see below). As
`accounts_head`, real Turso DB, real posted Bank & Cash lines for Shanti Boilers: a correctly
RBI/netbanking-shaped CSV (`Date,Narration,Withdrawal Amt,Deposit Amt,Balance`, `DD/MM/YYYY` dates
— exercising the header-alias map's multi-column withdrawal/deposit path and one of its date
formats, not a made-up shape) containing two rows engineered to match two real unreconciled lines
(a ₹20,00,000 receipt, a ₹58,056 payment) plus one with no match (a ₹250 bank charge):
- **Preview** (`POST .../import`, no `confirm`) correctly returned both real lines as `high`
  confidence (mutually unique within tolerance) and the ₹250 row as `unmatchedStatement`, with
  every other real unreconciled line correctly left in `unmatchedLedger`. Nothing written.
- **Confirm** (`confirm=1`) reconciled exactly those two real lines — confirmed directly against
  the DB (`reconciled=1`, real timestamp) — and left everything else untouched.
- **Quick-JE** on the unmatched ₹250 row posted a real, balanced 2-line entry (Bank & Cash 1001 /
  Bank Charges 5400) via the existing manual-JE engine and correctly reconciled the new Bank & Cash
  line.
- **UI**: clicked through to the Bank Reconciliation tab in the browser — Import Statement card
  renders, and the tick-off list below correctly shows exactly those three lines checked
  (everything else unchecked), reconciled/unreconciled balances matching the API exactly.
- Test rows left in the DB, per this session's established "keep demo/test data" precedent
  (§5v/§5w) — real, correctly-posted entries, not noise.

**Remaining gap, still genuinely open — not closeable without a real file**: the header-alias
map's coverage of an *actual* bank's column headings, date format, and amount-sign convention is
still only code-reviewed + tested against hand-built CSVs (a synthetic one on 2026-08-22, a
correctly-shaped-but-still-hand-built one above). Per the plan's own rule ("get one real export
sample, build the parser against that real file") and this session's explicit instruction ("no
work arounds, just compliant work"), this cannot be honestly closed by constructing a more
convincing fake — it needs one real netbanking CSV/XLS export per bank actually in use. Everything
downstream of parsing (matching, reconcile, quick-JE, UI) is now proven correct against real
ledger data; only the parser's real-world column/date/sign mapping remains unverified. Run
`node lib/bank-statement-import.mjs <real-file>` against each real export first — it will either
confirm the existing alias map or point at the exact one or two aliases/date formats that need
adding, per the header-anchor design's own tolerance for this.

## 5ac. Fixed Asset Register + Depreciation Schedule reports (2026-08-22, ACCOUNTING-IMPLEMENTATION-PLAN.md Phase 9, part 1 of 2)

Wires `fixed_assets`/`depreciation_runs`/`depreciation_run_lines` (§5z) into the Report Engine
catalog (§5x) like every other report — pure computation over data already captured, no new
calculation logic, so no design decision needed before building (unlike this same phase's Cash Flow
Statement, still pending — see below).

**Built:**
- **Fixed Asset Register** — `app/api/reports/fixed-asset-register/route.js`'s
  `computeFixedAssetRegister()` reuses `getFixedAssets()` (`lib/fixed-assets.js`, already existed)
  and adds the one new derived field, book value (`cost − accumulated_depreciation`). One row per
  asset: asset no, name, category, purchase date, method, cost, accumulated depreciation, book
  value, status. Not marked `heavy` — an asset list is naturally bounded, same reasoning as
  Customer Ledger.
- **Depreciation Schedule** — new `getDepreciationScheduleLines()` (`lib/data.js`), a plain join
  (`depreciation_run_lines` → `depreciation_runs` → `fixed_assets`) — the amount was already
  computed once by `lib/depreciation.mjs`'s `monthlyDepreciation()` at run time, never recomputed
  here. One row per asset per period run. Marked `heavy` (a growing per-period history), same
  precedent as TDS Deduction Register.
- Both wired into `lib/reports/catalog.js` (imports, `toTable`/`totals`) and
  `lib/reports/render.js` (`FIXED_ASSET_REGISTER_COLS`/`DEPRECIATION_SCHEDULE_COLS`) — no UI changes
  needed beyond that, the Reports tab is catalog-driven (`app/reports/page.js`'s
  `reportsForDepartment()`), confirmed by reading it rather than assumed.

**Verified**: `npm run build` succeeds clean, both new routes present in the route manifest. Every
existing selfcheck (`ledger-selfcheck.mjs`, `depreciation-selfcheck.mjs`,
`bank-match-selfcheck.mjs`, etc.) still passes — no regression.

**Update (2026-08-22, later same day) — live-verified against the real dev DB.** Per the user's
explicit "this is compliance, everything should be perfect" instruction, both reports (plus Cash
Flow — see below) were fully live-verified, not left at build-verified-only. As `accounts_head`
against the real remote Turso dev DB: created a real test fixed asset (`FA-1001
"PHASE9-LIVE-VERIFY-TEST-ASSET (safe to ignore)"`, Shanti Boilers, cost 12,000, salvage 2,000,
useful life 5y, SLM) via the actual `POST /api/fixed-assets` route — `fixed_assets` had been
genuinely empty until now, the first real row this table has ever held. Fixed Asset Register
correctly showed cost 12,000 / accumulated depreciation 0 / book value 12,000 / status active
immediately after purchase. Ran a real depreciation period (`POST
/api/fixed-assets/depreciation-run`, 2026-08) — computed 166.67 (= (12,000−2,000)/5/12 exactly,
by hand), Depreciation Schedule showed the one line correctly, Fixed Asset Register updated to
accumulated depreciation 166.67 / book value 11,833.33. Disposed the same asset at a loss
(`POST /api/fixed-assets/[id]/dispose`, disposal_amount 9,500) — register correctly flipped to
status disposed, disposed_at, disposal_amount, with book value still showing its pre-disposal
figure (11,833.33) as an audit-trail value, not an error — the same convention every real fixed
asset register uses to show what a disposed asset was worth immediately before disposal. **PDF
export verified for both** (`GET /api/reports/.../export?format=pdf`) — real PDFs (`%PDF-1.3`
magic bytes confirmed), correct Indian lakh/crore number formatting, all figures matching the JSON
exactly. One cosmetic bug caught and fixed while checking the PDF: the Fixed Asset Register's
`Status` column was too narrow, wrapping "disposed" onto two lines — widened (`Name` 26→22,
`Status` 8→12 in `lib/reports/render.js`), re-verified clean on one line. **On-screen gap found and
closed same day**: neither report (nor the pre-existing TDS Deduction Register) had a dedicated
on-screen card in `ReportsWorkspace.jsx`'s `SCREEN` map — clicking any of them in the browser showed
"No report selected", PDF export was the only working view. Per the user's explicit "no gaps"
instruction, fixed properly rather than left standing — see the follow-up entry below. Test asset
intentionally named/left in the DB (disposed, harmless) per this
session's established "keep demo/test data, name it obviously" precedent (§5v/§5w/§5z/§5aa).

**Update, same day — Cash Flow Statement built.** Design decisions resolved with the user first,
per the plan's own rule for this report: **indirect method** (start from net profit, adjust for
non-cash items and working-capital changes — not a direct listing of cash receipts/payments); and
**account-level categorization** into Operating/Investing/Financing, defaulted by account type with
a code-based exception for Fixed Assets/Accumulated Depreciation, overridable per account — not
per-transaction tagging.

- **`lib/cash-flow.mjs`**'s `indirectCashFlow(periodRows, investingCashLines, {categoryOverrides})`
  — pure, no DB, same precedent as `lib/ledger.mjs`. Default categorization
  (`defaultCashFlowCategory()`): Bank & Cash itself is excluded (it's the balance being explained,
  not a flow line); Fixed Assets (1400) / Accumulated Depreciation (1410) → Investing (a code
  exception — their balance change isn't their cash effect, see below); `account_type === 'equity'`
  → Financing; everything else → Operating. An explicit `chart_of_accounts.cash_flow_category`
  (new nullable column, `lib/db.js`) overrides the default for that one account — Bank & Cash's
  category is structurally fixed regardless, never overridable.
  - **Operating** = Net Profit (`profitAndLoss()`, already computed) + Depreciation Expense
    add-back (non-cash) + a full reversal of the Gain/Loss on Disposal account's period balance
    (already inside Net Profit as income-type, but its real cash effect is captured in Investing
    instead — reversing here avoids double-counting) + the signed cash effect of every
    Operating-categorized asset/liability account's period balance change (the classic
    working-capital adjustment: `trialBalance()`'s already-signed `balance` field needs just one
    type-dependent flip — asset increase = cash used, liability increase = cash sourced).
  - **Investing** reads the real Bank & Cash lines from `fixed_asset`/`fixed_asset_disposal`
    -sourced journal entries directly (new `getFixedAssetCashLines()`, `lib/data.js`), not a
    generic account-balance-change loop — a disposal removes cost at book value, not at what was
    actually received, so Fixed Assets/Accumulated Depreciation's own balance change is the wrong
    number for this section; the actual cash lines are always correct.
  - **Financing** = the signed cash effect of every Financing-categorized account's period balance
    change (same formula as Operating's working-capital loop, generalized).
  - **Selfcheck** (`scripts/cash-flow-selfcheck.mjs`) builds one realistic mixed period by hand
    (partial customer collection, partial vendor payment, direct-paid salary, a fixed-asset
    purchase, a depreciation run, a disposal at a loss, a disposal at a gain, an equity injection)
    and proves the real invariant an indirect statement must satisfy: **its computed net change in
    cash equals the actual net change in the Bank & Cash account for the same rows** — not just
    that the arithmetic runs. Also proves the account-level override actually moves a line between
    sections without changing the total. All assertions pass.
- **`app/api/reports/cash-flow/route.js`**'s `computeCashFlow()` — wired into
  `lib/reports/catalog.js` (new `cash-flow` entry) and `lib/reports/render.js`'s `cashFlowTable()`
  (three named sections — Operating/Investing/Financing — same multi-section shape GSTR-1 already
  established for a report with more than one logical table).
- **`PATCH /api/chart-of-accounts/[id]`** — new, narrow: the one editable field on an existing
  account is `cash_flow_category` (code/name/account_type stay immutable, per the parent route's
  existing convention). UI: `ChartOfAccountsCard` (`AccountsWorkspace.jsx`) gained a per-account
  "Auto/Operating/Investing/Financing" select (hidden for Bank & Cash, whose category is
  structural).
- `DEBIT_NORMAL_TYPES` exported from `lib/ledger.mjs` (was a private const) — `lib/cash-flow.mjs`
  needed the same debit/credit-normal convention `trialBalance()` already encodes, not a second
  copy of it.

**Verified**: `npm run build` succeeds clean, all new routes present. `scripts/cash-flow-selfcheck.mjs`
and every pre-existing selfcheck still pass.

**Update (2026-08-22, later same day) — live-verified against the real dev DB, including the
compliance-critical invariant.** As `accounts_head` against the real remote Turso dev DB, using
Shanti Boilers' real pre-existing ledger activity (a full realistic day already in the books:
sales invoice, credit note, two vendor bills, a debit note, a salary slip, a manual JE + its
reversal, a material issue, two customer receipts, a vendor payment) plus the fixed-asset
purchase/depreciation/disposal sequence from the Fixed Asset Register verification above:
- **Baseline day (2026-08-20, before any Phase 9 test data)**: `GET /api/reports/cash-flow`
  returned Net Profit 33,38,375 / working-capital total 6,86,944 / Net Cash from Operating
  40,25,319, Investing/Financing both 0, Net Change in Cash 40,25,319 — checked by hand against
  every individual account's real ledger rows (AR, Raw Material Inventory, GST Input Credit,
  Accounts Payable, GST Output Payable, TDS/PF/ESI/PT Payable) and against the actual real
  Bank & Cash movement for that day (sum of every real `1001`-coded line): **exact match to the
  rupee**, no rounding drift.
- **The fixed-asset day (2026-08-22) in isolation**: before disposal, Net Operating 0 (depreciation
  fully non-cash, correctly added back), Investing −12,000 (the purchase), Net Change −12,000 —
  matches the real Bank & Cash movement for that day exactly. After disposal, Investing −2,500
  (−12,000 purchase + 9,500 disposal proceeds), the loss's `disposalReversal` correctly added back
  2,333.33 into Operating (fully offsetting the loss so Operating still nets to 0 for a day with no
  other real economic activity), Net Change −2,500 — again an exact match to the real ledger.
- **Combined 3-day range (2026-08-20 to 2026-08-22)**: Net Change in Cash 40,22,819.00 — exactly
  the baseline day's 40,25,319 plus the fixed-asset day's −2,500, proving multi-day aggregation is
  correct, not just single-day.
- **Account-level override, on the real chart of accounts**: `PATCH /api/chart-of-accounts/[id]`
  set GST Output Payable's `cash_flow_category` to `financing`. Recomputing the baseline day moved
  exactly 6,30,000 from Operating's working capital into Financing (Operating 40,25,319→33,95,319,
  Financing 0→6,30,000) while **Net Change in Cash stayed exactly 40,25,319** — proving the override
  only changes presentation, never the total. Reverted the override (`cash_flow_category: null`)
  and recomputed once more: output matched the original baseline exactly, confirming a clean revert
  with no residual side effect. The override was left reverted (Auto) — this was a mechanism test,
  not an intended real reclassification of that account.
- **PDF export verified** for Cash Flow Statement too — a real PDF, correct three-section layout
  (Operating/Investing/Financing), correct Indian number formatting with parenthesized negatives,
  figures matching the JSON exactly for the full-FY default range.

This is the strongest verification standard this session could apply short of running a second,
independent implementation: every number was either checked by hand against the real ledger rows
that produced it, or checked against an actual real cash movement it's supposed to explain — not
just "the request returned 200." **No discrepancies found.**

## 5ad. Closing the on-screen report gap (2026-08-22, same day) — Fixed Asset Register, Depreciation Schedule, TDS Deduction Register, Cash Flow Statement

Found while live-verifying §5ac/above: none of these four reports had an entry in
`ReportsWorkspace.jsx`'s `SCREEN` map, so selecting any of them in the browser rendered "No report
selected" — a working `compute()`/`toTable()`/PDF export existed, but no on-screen view. TDS
Deduction Register's gap predates this session (built in an earlier pass, §5z); the other three
were this session's own new reports. Per the user's explicit "I don't want any gaps in the works"
instruction, closed properly rather than left as a documented limitation.

**Built** — two new card files, following this codebase's existing per-report-card convention
(`components/reports/TrialBalanceCard.jsx`, `ProfitLossCard.jsx`, etc.) rather than a generic
reflection-based renderer (this app's own stated position: report shapes differ too much for one
generic mapper to be honest — REPORT-ENGINE-PLAN's reasoning, still followed here):
- **`components/reports/FixedAssetReportCards.jsx`** — one shared `ListReportCard` inner component
  (columns passed as props) plus three thin exports (`FixedAssetRegisterCard`,
  `DepreciationScheduleCard`, `TdsRegisterCard`) — same "one shared renderer, thin per-report
  wrappers" shape `components/reports/AgingCard.jsx` already established for Receivables/Payables
  Aging, extended here to three structurally-similar-but-not-identical flat-list reports instead of
  two identical ones.
- **`components/reports/CashFlowStatementCard.jsx`** — bespoke (three named sections with
  presentation rows, not raw ledger rows — closer to `ProfitLossCard`'s Income/Expense split than to
  a flat list, so it didn't fit the shared `ListReportCard`).
- Wired into `ReportsWorkspace.jsx`'s `SCREEN` map (4 new entries) and its import list.

**Live-verified in the browser** (not just build-verified) — as `accounts_head`, real dev DB, same
Shanti Boilers data as §5ac's Cash Flow verification: all four reports clicked through and
confirmed rendering real, correct data on-screen — Fixed Asset Register showed FA-1001's real
cost/accumulated depreciation/book value/status; Depreciation Schedule showed its one real line
(166.67); TDS Deduction Register showed the real TESTBILL-001 line (58,056 gross / 580.56 TDS);
Cash Flow Statement rendered all three sections with the exact same figures already hand-verified
against real ledger rows in §5ac, including the final **Net Change in Cash: 40,22,819** tying to
the actual Bank & Cash movement. `npm run build` clean, every selfcheck still passes.

**Also fixed along the way**: the dev machine's disk was nearly full (135 MiB free of 228 GiB),
which broke `npm run build` with `ENOSPC` — cleared the regenerable `.next` build cache (freed
~1 GiB) to unblock verification; this is a host-level disk-space issue, not a code bug, and is
worth the user's own attention if it recurs (the machine is at ~97% disk usage even after this
cleanup).

## 5ae. Company Entities — statutory/registration profile per legal entity (2026-08-22)

New Accounts tab (additive — the plain "Company Settings" tab from Phase 0 is untouched) turning
`company_settings` into the ERP's real company-applicability layer, per the confirmed architecture
rule: `statutory-rates-hub` stays a national-statutory-rate source only; every company-specific
fact (a GSTIN's own registration status, whether PF/ESI/PT actually applies to *this* company) is
Shanti Ops' job, computed or stored here, never delegated to the hub.

**Research finding, before building anything**: a Sandbox (Quicko) GSTIN-verification client
(`lib/sandbox.js`) and a tenant-authed passthrough route (`app/api/gstin/verify`) already exist —
but in the hub repo, not here, and were never mentioned in either repo's docs. Ran them live against
both real GSTINs during design (not guessed field names) — full real responses captured: legal/trade
name, GST status, taxpayer type, registration date, constitution, jurisdiction, e-invoice-enabled
status, nature of business, and (a genuine find) a real additional registered premises for Shanti
Techno Fab neither company_settings nor anyone on this project had on record. PAN is not a separate
Sandbox field — derived from the GSTIN itself (chars 2–12), same precedent §5z already used. PF/ESI/PT
registration numbers and applicability have no API at all; applicability is a local computation
(employee headcount vs. statutory thresholds, already-existing `professional_tax_slabs`), never a
fetch.

**Built:**
- **`company_settings` schema extension** (`lib/db.js`, `addColumn`-idempotent) — trade_name,
  gst_status, gst_taxpayer_type, gst_registration_date, gst_constitution (new value columns), each
  paired with its own `_source`('sandbox'|'manual')/`_updated_at`; the same provenance pair
  retrofitted onto the pre-existing legal_name/gstin/pan/state fields, backfilled `'manual'` for
  both real companies' existing rows (confirmed live — see below) since none of that was ever
  fetched. Fields Sandbox only ever returns as one atomic snapshot (jurisdiction, cancellation date,
  e-invoice status, nature of business, additional premises) share one `gst_extra_source`/
  `gst_extra_fetched_at` pair rather than five redundant identical ones — a deliberate scoping call,
  confirmed with the user before building. PF/ESI/PT: `{pf,esi,pt}_applicable_override` (NULL = use
  the computed value), `{pf,esi,pt}_{establishment_code,employer_code,registration_no}` (pure
  user-entry, no API exists), `{pf,esi,pt}_updated_at`.
- **`lib/company-entity.mjs`** (pure, own selfcheck per this codebase's ground rules) —
  `mapSandboxResponse()` shapes a raw Sandbox reply onto our columns; `diffCompanyEntity()` is the
  actual "must not silently overwrite" enforcement: classifies each trackable field
  unchanged/new/safe (prior value itself came from a fetch)/**manual-conflict** (prior value was a
  human correction — and, deliberately conservative, an *unset* provenance on a non-empty value is
  also treated as manual-conflict, never assumed safe); `computeApplicability()` returns
  `{computed, override, effective}` for PF/ESI/PT — never collapsed into one boolean, per explicit
  instruction, so the UI can always show *why* a value is what it is, not just the final answer.
- **Two-phase preview/confirm GSTIN refresh** (`app/api/company-settings/[id]/verify-gstin`), same
  shape as `gstr2b/upload` and `bank-reconciliation/import`: preview fetches fresh + diffs, writes
  nothing; confirm **re-fetches server-side** (never trusts client-supplied fetched values for a
  compliance-relevant write) and applies only the caller-selected fields, each stamped
  `source='sandbox'`. Calls the hub's *existing* `/api/gstin/verify` with the same
  `STATUTORY_RATES_HUB_API_KEY` already used for rate sync — no hub changes needed or made.
- **`GET /api/company-settings/[id]/applicability`** — wraps `computeApplicability()` over real
  headcount (`employees.company`, active only) and `professional_tax_slabs` state coverage.
- **`PATCH /api/company-settings`** extended — any hand-edited trackable field now stamps
  `source='manual'` + `updated_at`, which is what protects it from a later refresh; PF/ESI/PT
  overrides and registration numbers write through the same route.
- **UI** (`AccountsWorkspace.jsx`, new "Company Entities" tab) — entity switcher; a GST Registration
  card showing every trackable field with a "Sandbox, {date}" / "Manual, {date}" tag and a **Refresh
  from GST** button opening the diff dialog (unchanged fields hidden; `new`/`safe` fields pre-checked;
  `manual-conflict` fields **unchecked by default**, flagged "will overwrite a manual entry"); the
  fetch-only GST-detail snapshot (jurisdiction, e-invoice status, nature of business, additional
  premises) shown read-only with its one shared timestamp; a PF/ESI/Professional Tax card showing
  the computed reasoning, an explicit Auto/Override selector (never a bare checkbox — the exact
  "six months later nobody knows why" failure mode named during design), and registration-number
  inputs.

**Bug found and fixed while live-verifying, not shipped silently**: `verify-gstin`'s hub-fetch
helper called `res.json()` unconditionally and crashed with `"Unexpected token '<'..."` on a non-JSON
response instead of surfacing a clean error. Fixed to catch the parse failure and return an actionable
message instead — a real defensive-coding gap in this repo's own new code, not the finding below.

**External finding, not a Shanti Ops defect — flagged, not worked around**: the hub's
`app/api/gstin/verify` route and `lib/sandbox.js` are **untracked in the hub's git repo** (`git
status` shows `??`) — never committed, never pushed, therefore never deployed to the live Render
instance (`statutory-rates-hub.onrender.com`) Shanti Ops actually talks to. Confirmed directly: a
real `curl` against the deployed hub's `/api/gstin/verify` returns a genuine Next.js 404 page, not
JSON. Per instruction, the hub was not modified, committed, or deployed by this work — that's the
separate "hub lifecycle hardening" effort's job. Once that lands, the GSTIN refresh flow needs no
further Shanti Ops changes to start working end-to-end; everything on this side is already built
and correct up to that boundary.

**Update (2026-08-23)**: this external blocker is resolved — a direct `curl` against the deployed
hub's `/api/gstin/verify` now returns a real `401 {"error":"Unauthorized"}` instead of a 404, i.e.
the route is deployed and reachable, just correctly rejecting the unauthenticated probe. Not
re-exercised end-to-end with a real GSTIN + the actual `STATUTORY_RATES_HUB_API_KEY` in this pass
(a real Sandbox/Quicko lookup is a paid, rate-limited call and this check was incidental to a
different task) — the deployment boundary this section named is gone, but a full live GSTIN-refresh
click-through is still worth doing once there's a real reason to touch that flow.

**Live-verified against the real dev DB** (as `accounts_head`, real Turso): schema migration and
backfill applied cleanly — both companies' pre-existing legal_name/gstin/state/pan correctly stamped
`source='manual'` with `updated_at` = their original `created_at`. Applicability computation
verified against real data: Shanti Boilers (31 real active employees) correctly shows PF and ESI
applicable with the exact headcount reasoning; Shanti Techno Fab (0 employees currently recorded
under that company in `employees` — a real data observation, not a bug, out of this task's scope to
correct) correctly shows PF/ESI not applicable while Professional Tax still applies (state-based,
correctly independent of headcount). The override mechanism verified through all three states —
override=true, override=false (effective genuinely diverging from computed=true, the case that
matters), and reverted to auto — with computed/override/effective all independently correct and
visible at every step, then reverting exactly to the original baseline. Registration-number save and
manual-edit provenance stamping (`trade_name` hand-entered → `trade_name_source='manual'` with a
real timestamp) both confirmed. The GSTIN-refresh preview/diff/confirm flow itself is code-reviewed
and defensively correct (confirmed via the clean-error path above) but **not** exercised end-to-end
against a real Sandbox response — blocked entirely on the external hub-deployment gap above, not on
anything still to do here.

## 5af. Hub → Shanti Ops statutory-rate pipeline — production-readiness pass (2026-08-23)

`lib/rate-sync.js`'s `syncRatesFromHub()` (built §5y) had existed since 2026-08-20 but was only
ever live-verified once, against an empty hub (`{pulled:0, applied:0, cursor:0}`). The hub now
carries a real, substantial approved dataset for the first time, which is exactly when the
pipeline's two structural weaknesses would actually bite. This pass proved the pipeline correct
end-to-end against that real data and fixed both defects — no new features, no hub changes beyond
its own normal human-approval workflow API.

**One real bug found and fixed, not part of the original plan**: `syncRatesFromHub()` never merged
a hub row's top-level `effective_from`/`effective_to` fields into the payload it hands to
`insertGstRate`/`insertVendorTdsRate` — both require `effective_from`, so every prior "verified"
run silently never exercised this path (an empty hub has no rows to expose it). Found live on this
run's first real non-empty batch. Fixed with a one-line merge in the apply loop.

**Two structural defects found and fixed** (both required to satisfy the task's own idempotency/
no-partial-corruption bar, not scope creep):
1. **None of `insertGstRate`/`insertVendorTdsRate`/`insertIncomeTaxSlab`/`insertProfessionalTaxSlab`
   (`lib/data.js`) were idempotent** — plain `INSERT`, no dedup, no unique constraint in the schema
   either. Re-running a sync with an unchanged cursor would have inserted every row a second time.
   `patchStatutoryRates` (`lib/payroll.js`) was already safe (single-row `UPDATE`).
2. **A mid-batch failure, combined with (1), would duplicate rows on retry**: `syncRatesFromHub()`
   applies each row as its own statement (no transaction) and only advances
   `hub_sync_state.cursor` once, after the whole loop succeeds. If row N throws, rows before it are
   already committed but the cursor never moves — the next attempt re-pulls the same batch and,
   without dedup, re-inserts rows 1..N-1. With defect (1) fixed this self-heals: a retry's dedup
   check skips what already landed and only applies from where it actually failed. No transaction
   wrapping or cursor-timing change needed.

**Fix**: a `SELECT ... WHERE <natural key> LIMIT 1` guard before each `INSERT` in all four
functions, no-op (return the existing id) on an exact match — never a fuzzy merge, a genuinely
different payload for the same identity (e.g. a corrected threshold at the same `effective_from`)
still inserts as a new row, matching how these tables are already versioned (insert, never
update-in-place). Natural keys: `gst_rates` (hsn_code, effective_from, effective_to, rate_pct),
`vendor_tds_rates` (section, effective_from, effective_to, rate_pct, threshold_amount),
`income_tax_slabs` (regime='new' hardcoded, financial_year, min_income, max_income, rate_pct) —
`insertIncomeTaxSlab` still hardcodes `regime='new'` regardless of what the hub might send, a
latent gap named honestly, not fixed speculatively since no old-regime row exists yet to test
against — `professional_tax_slabs` (state, min_gross, max_gross, amount).

**Real, organic evidence of the pre-fix defect**: before this pass, the local DB already carried
one 194H `vendor_tds_rate` row and one Maharashtra 0–7,500 `professional_tax_slabs` row from an
earlier, unlogged partial sync attempt — `hub_sync_state.cursor` was still `0` despite their
presence, the exact failure signature defect (2) describes. The dedup guard correctly treated both
as already-applied during the real run below, rather than duplicating them.

**Live-verified, end to end, against the real deployed hub and the real Shanti Ops Turso DB** (no
mocked hub rows in the production data path — the one exception, isolated and cleaned up, is
noted below):
- **Controlled failure-path proof** (a genuine gap in the "how do we prove no-partial-corruption"
  story without planting a bad row in the real hub): pointed `STATUTORY_RATES_HUB_URL` at a
  throwaway local HTTP server for one test cycle (Next dev auto-reloads `.env.local`, confirmed via
  server logs), serving one good synthetic row + one deliberately malformed row (missing
  `rate_pct`) through the *real* `POST /api/statutory-rates/sync` route — the actual production
  code path, not a reimplementation. First call: clean `400` (`"section, rate_pct, effective_from
  are required"`), the good row committed, cursor untouched. Second call (bad row now fixed, same
  "already-applied" good row still in the batch): the good row was correctly skipped (no
  duplicate), only the fix landed, cursor advanced. Synthetic rows deleted and
  `hub_sync_state.cursor` restored to its pre-test value before touching the real hub.
- **Run A** (real hub, cursor 0 → 231): `{pulled:14, applied:14, cursor:231}` — 2 `gst_rate`
  (HSN 9983/9984), 8 `vendor_tds_rate` (194C×2/194H/194J×2/194Q/206AA-206CC/194T), 1
  `statutory_rate` patch, 3 `professional_tax_slab` (Maharashtra×2/Karnataka). Confirmed the two
  already-present rows (194H, Maharashtra 0–7,500) deduped correctly, not doubled; every other row
  landed exactly once. The retracted 206C(1H)/194A-wrong-threshold rows (ids 215/216) correctly
  never appeared (excluded server-side by the hub's own `retracted_at IS NULL` filter).
- **Run B** (immediately after A): `{pulled:0, applied:0, cursor:231}` — first idempotency proof,
  zero row-count change confirmed across all three tables.
- **Approved hub id 239** (194A correction — rate 10%, threshold ₹10,000, effective 2026-04-01,
  replacing retracted id 216's wrong ₹5,000 threshold) via the hub's own
  `POST /api/rates/:id/approve` after confirming its payload matched the expected correction
  exactly — normal human-approval usage, not a hub modification. **Done only after explicit
  user confirmation** — auto-mode's safety classifier correctly flagged this as a real,
  hub-wide-visible action against a live production system and paused for approval before
  proceeding.
- **Run C**: `{pulled:1, applied:1, cursor:239}` — the new 194A row landed exactly once, correct
  values. **Run D** (immediately after C): `{pulled:0, applied:0, cursor:239}` — second idempotency
  proof, confirming new data doesn't get re-applied either.
- **Calculation checks against what actually landed** (honest about what's testable —
  `gst_rates`/`vendor_tds_rates` have no automatic effective-date resolution anywhere in this
  codebase, confirmed by grep; `vendor_tds_rates` is only ever consumed by explicit row-id
  selection, `gst_rates` isn't consumed in any live calc path at all, per §5r/§5y's own admission,
  unchanged by this pass): `lib/gst-calc.mjs`'s `tdsAmount()` against the real synced 194A/194H/
  194Q/206AA-206CC rows all correct (e.g. 194A on ₹50,000 → ₹5,000 deducted, below-threshold →
  ₹0); `lib/payroll.js`'s Professional Tax slab resolution against the newly-synced Maharashtra/
  Karnataka bands all correct. Income-tax slab resolution for FY2026-27 was **not** exercised
  against synced data — the hub has no approved `income_tax_slab` rows yet, only drafts; local
  seed data (independent of the hub) is what's actually in use, stated honestly rather than
  claimed as tested.
- **Auth/error-handling**: wrong or missing `x-sync-key` → clean `401`, no state change. Wrong
  `STATUTORY_RATES_HUB_API_KEY` → clean `400` (`"Hub returned 401"`), no partial writes (fails
  before the loop starts) — confirmed cursor and row counts unchanged afterward. Both hub env vars
  restored to their real values immediately after each test.
- **Regression check**: every existing selfcheck passes (one unrelated, pre-existing exception —
  `lib/report-pdf-selfcheck.mjs` fails to run under plain `node` on this machine's Node 18.16.0 due
  to a CJS/ESM interop issue in a JSX-bearing file; unrelated to this change, not touched).
  `npm run build` failed outright under the environment's default Node 18.16.0 (Next 14.2.5 requires
  ≥18.17.0) — re-run against a second, newer Node install already present on the machine
  (`/opt/homebrew/bin/node`, v23.9.0) and completed clean.

**Remaining, honestly-stated gaps** (not this pass's job to close): no HSN/section-based automatic
rate resolution anywhere in the live calc paths yet (pre-existing, deferred since §5r); the hub's
retraction model doesn't push a correction to a tenant that already pulled a rate *before* it was
retracted — a real model limitation, worth naming, not worth a speculative fix absent a real
incident; `insertIncomeTaxSlab`'s hardcoded `regime='new'` (noted above); the already-known,
deliberately-deferred 206C(1H)/TCS cumulative-threshold-tracking gap from §5z, not re-litigated
here.

## 5ag. Production-ready daily rate-sync cron endpoint (2026-08-23)

§5af proved `syncRatesFromHub()` correct and idempotent by hand — this pass turns it into a job
suitable for an actual daily Cloudflare Cron Trigger to call, per instruction: idempotent apply
(already had this), cursor advanced only after success (already had this), plus what was still
missing — a post-write **verification** step, a persisted **heartbeat** distinguishing "the cron
isn't firing" from "the cron fires and keeps failing," differentiated **non-2xx** status codes, and
a **securely authenticated** endpoint. The Cloudflare Trigger itself is explicitly not created —
this is the endpoint a future Worker's `scheduled()` handler would `fetch()`.

**Built:**
- **`hub_sync_state` schema** (`lib/db.js`, `addColumn`-idempotent, additive) — three new columns
  alongside the existing `cursor`/`last_synced_at`: `last_run_at` (every attempt, success or
  failure — the actual heartbeat), `last_status` (`'success'`|`'error'`), `last_error` (message on
  failure). Kept `last_synced_at` semantics unchanged (only moves on a successful pull) so it still
  answers "when did data last actually change" separately from "is the job still running at all."
- **`lib/rate-sync.js`** — `syncRatesFromHub()` gained a **verification** step: after the cursor
  `UPDATE`, a read-back confirms the persisted value matches `nextCursor`, throwing loudly on
  mismatch rather than reporting success on a write that silently didn't land — a real, not
  hypothetical, risk given the ETIMEDOUT flakiness this exact pipeline hit in §5af. A new
  `HubSyncError` class tags hub-communication failures (unreachable, non-2xx) distinctly from
  internal ones (a bad insert, a failed verification), so the route can pick 502 vs 500. New
  `runRateSyncJob()` wraps the sync with the heartbeat write — success or failure, best-effort even
  if the DB write itself is what's struggling — and rethrows so the route still returns non-2xx. New
  `getRateSyncHeartbeat()` for the read side.
- **`app/api/statutory-rates/sync/route.js`** — auth now uses `crypto.timingSafeEqual` (constant-time
  comparison) instead of `!==`, since this is a long-lived static secret sitting behind no
  login-style rate limiting. `POST` runs the job (`ok:true/false` + `200`/`502`/`500`/`401`,
  `audit()`-logged both ways as `actor: 'system:rate-sync-cron'`). New `GET` (same auth) returns the
  heartbeat row without triggering a sync — for a monitoring check to confirm the cron is actually
  firing, not just that the endpoint exists.
- **Retry safety, unchanged and re-confirmed**: every insert already dedupes on its natural key
  (§5af), the cursor still only advances once per successful batch, so a Worker retry after a
  transient failure — or two overlapping invocations — replays safely. No new locking added:
  idempotency already makes concurrent runs safe without one, and a lock table for a once-daily job
  would be complexity with no real failure mode behind it (ponytail: add a lock only if overlapping
  runs are ever observed to actually collide on something idempotency doesn't cover).

**Live-verified against the real dev DB and the real deployed hub**: migration applied cleanly (new
columns present, existing `cursor`/`last_synced_at` untouched). Auth rejects a wrong or missing key
on both `GET` and `POST` with `401`. A real successful run against the live hub returned
`{ok:true, pulled:0, applied:0, cursor:239}` and the heartbeat correctly showed `last_run_at`
freshly stamped, `last_status:'success'`, `last_error:null`. Pointing `STATUTORY_RATES_HUB_URL` at
an unreachable address (real network failure, not simulated) returned a clean `502` with the actual
fetch error message, and the heartbeat correctly recorded `last_status:'error'` with that message
while `cursor`/`last_synced_at` stayed untouched — confirming a failed run neither corrupts state
nor silently disappears. Restoring the real hub URL and re-running recovered cleanly back to
`last_status:'success'`. All pre-existing selfchecks pass; `npm run build` clean under Node 23.9.0
(see §5af for why the environment's default Node 18.16.0 can't run the build).

**Update (§5ah, same day)**: the Cloudflare Worker and Cron Trigger described as "not done" below
were built, deployed, and live-verified later this same session — see §5ah for the full record.
This section's own scope (the endpoint itself) is unchanged by that; leaving the original text
below for the historical record of what this specific pass did and didn't include.

**Explicitly not done in this pass**: no Cloudflare Cron Trigger or Worker created yet — this is
the endpoint such a Worker would call, nothing on the Cloudflare side existed at this point.

## 5ah. Cloudflare Worker + Cron Trigger deployed — daily rate-sync now live (2026-08-23)

§5ag built the endpoint; this pass actually stood up the scheduler in front of it, per explicit
instruction and only after confirming exact setup steps first. Sync logic untouched throughout.

**Built** (`workers/rate-sync-cron/`, a standalone Worker project, separate toolchain from the
Next.js app):
- `src/index.js` — `scheduled()` calls `POST /api/statutory-rates/sync` with `x-sync-key`, treats
  any non-2xx as a failed run, and reports success/failure to a healthchecks.io dead-man's-switch
  (ping on success, `/fail` ping on failure — healthchecks.io's own missed-check timeout is what
  catches "the cron stopped firing entirely," which no amount of code inside the Worker itself could
  ever detect). A `fetch()` handler, gated by the same shared secret, allows a manual test trigger
  without waiting for the schedule.
- `wrangler.toml` — `crons = ["0 21 * * *"]` (21:00 UTC = 02:30 IST daily, off-hours for the
  Hyderabad-based business), `SYNC_URL` as a plain var (not sensitive — it's the already-public
  endpoint address).
- Config validated locally (`wrangler deploy --dry-run`) before any Cloudflare account was touched.

**Deployed**, into the same Cloudflare account as the existing R2 storage (`pshantiops@gmail.com`,
account `61917184e194dc4b792e0a20bca421b3`) — confirmed intentionally, not assumed. Required
registering a first-ever `workers.dev` subdomain on that account (`pshantiops.workers.dev`) as a
one-time prerequisite. Worker live at
`https://shanti-ops-rate-sync-cron.pshantiops.workers.dev`. **Cron Trigger registered as
`0 21 * * *`** — confirmed directly in Cloudflare's own deploy response, not just local config.
Both `RATE_SYNC_KEY` and `HEALTHCHECK_URL` stored as Cloudflare Worker secrets (`wrangler secret
put`, interactive prompt only — never passed as a command argument, never logged).

**Security incident during setup, handled**: the user pasted the real `RATE_SYNC_KEY` value in
plaintext into the chat while reporting a manual-trigger result. Flagged immediately as compromised
(chat transcripts may be logged/stored); the user rotated it in Render, Cloudflare, and local
`.env.local`. The exposed value was never repeated, reused, or stored by the assistant, and is now
dead everywhere it existed.

**Real operational finding, not a bug**: the statutory-rates-hub (`statutory-rates-hub.onrender.com`)
runs on Render's free tier and cold-starts (~23s) after inactivity, which produced two transient 502s
during manual-trigger testing before the hub was warm. Self-resolves once warm, but since the cron
fires once daily the hub will likely be cold on most real runs — some daily runs may see this delay,
or an occasional false-failure ping to healthchecks.io. Not fixed (no request was made to retry or
to move the hub off the free tier); noted for awareness.

**Live-verified, full chain, real data**: a manual trigger through the Worker (`x-trigger-key`,
never exposed) returned `{"ok":true,"status":200,...}`; the production `hub_sync_state` heartbeat
advanced (`last_run_at` moved, `last_status:'success'`) confirmed by direct DB read (no secret
needed); the user independently confirmed a fresh success ping appeared on the healthchecks.io check
page. All three links of the chain — Worker → sync endpoint → heartbeat → healthchecks.io — verified
with real requests against the real production deployment, not simulated.

**Post-deployment data-integrity check** (a follow-up "make sure nothing broke" pass, same day):
direct read-only queries against the real Turso DB confirmed zero duplicates in any rate-master
table despite the day's multiple retries including the two cold-start 502 failures (`gst_rates` 2,
`vendor_tds_rates` 14, `professional_tax_slabs` 6, `statutory_rates` 1 — all exactly matching the
pre-existing known-good counts from §5af); Trial Balance for Shanti Boilers exactly balanced
(₹86,45,209.67 = ₹86,45,209.67); zero unbalanced individual journal entries; zero orphaned
`journal_entry_lines`; `journal_entries`/`journal_entry_lines` row counts unchanged by the failed
502 attempts (confirming they failed *before* touching the DB, exactly as designed); all of this
session's own earlier test entries (bank-reconciliation reconciled flags, the quick-JE test) still
exactly as left, not double-posted by the repeated Worker triggers. No corruption found anywhere.

## 5ai. RCM real-transaction test — two real bugs found and fixed (2026-08-23)

§5z/§5aa's RCM (reverse charge) support had only ever been verified via pure-function math checks
(`ledger-selfcheck.mjs`) — never a real PO→Vendor Bill→Approve cycle, deliberately, to avoid
fabricating a fake transaction in the real books. This session ran that real cycle for the first
time (a clearly-labeled, disposable test PO/bill against a real supplier, no BOM/inventory linkage
so it couldn't touch real stock) — and it immediately failed with `Journal entry not balanced:
debit 118000 != credit 100000`. **Per explicit instruction, this checklist item is intentionally
NOT being marked "done"** — real verification only counts when a real business RCM transaction
happens; this test only proves the code path isn't broken.

**Bug 1 — `vendorBillLines()` double-excluded tax under RCM** (`lib/ledger.mjs`). The caller
(`record-bill` route) already computes `payableAmount = subtotal - tdsAmt` under RCM (tax already
excluded, since RCM means the vendor is never owed the tax portion at all). `vendorBillLines()` then
subtracted `taxAmount` from that *again* before crediting Accounts Payable — a real RCM+TDS bill
(subtotal ₹1,00,000, tax ₹18,000, TDS ₹2,360) posted AP at ₹79,640 instead of the correct ₹97,640,
throwing the entry off by exactly the tax amount. The existing pure-function selfcheck never caught
this because its hand-picked `payableAmount` (1170, for a 1000/180/10 case) didn't match what the
real route actually produces for RCM (990) — the test was internally consistent but not
representative of real input. Fixed by removing the double-subtraction; `AccountsPayable` now
credits `payableAmount` as-is, since the caller has already done the tax exclusion. Selfcheck's test
data corrected to use a realistic `payableAmount`, with a comment explaining why the old value
masked the bug.

**Bug 2 — status flips to "approved" even when the GL post fails**
(`app/api/vendor-bills/[id]/route.js`, `app/api/sales-invoices/[id]/route.js`). Both routes ran the
`UPDATE ... SET status = 'approved'/'issued'` *before* calling `postJournalEntry()`. When Bug 1
threw on the first real test, the bill had already been marked `approved` in the DB — with no
ledger entry at all. Worse, the vendor-bill route's own re-post guard
(`!['approved','paid'].includes(bill.status)`) then read that corrupted status and concluded the
bill was "already settled," permanently skipping any future posting attempt — no retry could ever
fix it. `postJournalEntry()` itself is correctly idempotent (checks for an existing entry by
`source_type`/`source_id` before inserting), so the actual fix was reordering: both routes now call
`postJournalEntry()` (and, for vendor bills, the inventory-costing loop) *before* the status/field
`UPDATE`. A future posting failure now leaves the document status untouched, so a retry lands on the
same "not yet settled" branch and can post cleanly — no permanently-stuck documents.

**Verified for real** (Shanti Boilers, real supplier, disposable test PO/bill/items — no BOM or
inventory_items link, so the inventory-costing branch never fired, confirmed by inspection): after
both fixes, the same RCM+TDS bill posted a fully balanced entry — Dr Raw Material Inventory 100,000,
Dr GST Input Credit 18,000, Cr Accounts Payable 97,640, Cr GST Output Payable 18,000, Cr TDS Payable
2,360 (118,000 = 118,000) — exactly the expected RCM accounting treatment. Trial Balance moved from
8,645,209.67 to 8,763,209.67 (exactly +118,000 on both sides) with the test entry in place, then
**all test artifacts deleted** (journal entry + lines, vendor bill + items, PO + item) per
instruction, and Trial Balance confirmed back to exactly 8,645,209.67 — zero residue.

**Sales-side RCM checked by inspection, not live-tested this pass**: `salesInvoiceLines()`
(`lib/ledger.mjs`) doesn't rely on any caller-precomputed tax-exclusive figure the way
`vendorBillLines()` did — its RCM branch posts `subtotal` straight to both AR and Revenue, no second
subtraction possible, and sales invoices have no TDS interaction to combine with. Code review found
no equivalent bug. Left un-exercised with a real invoice deliberately: converting a real accepted
quotation would consume a real sequential invoice number from the actual GST-numbering series, and
deleting the invoice afterward would leave an unexplained gap in that series — a real compliance-
hygiene cost the Vendor Bill side doesn't have (bill numbers are free text, not a controlled
sequence). Do this only when a real sales RCM transaction is actually needed, per the same
real-only philosophy this section holds RCM to overall.

**Related risk found by inspection, not live-tested, not fixed — flagged honestly**: the same
"state-changing UPDATE before the risky `postJournalEntry()` call" shape also exists in
`app/api/material-issues/route.js` (inventory `on_hand` is decremented before the GL post attempt)
and `app/api/salary-slips/[id]/route.js` (status updated before posting). Neither was exercised or
touched this session — surfacing this now rather than treating "found two, matching the pattern
against a couple of siblings" as license to silently patch everything nearby without live-testing
each one.

## 5aj. Dispatch — accounting integration: freight cost, invoice linkage, e-way bill, register (2026-08-23)

Dispatch (`packing_lists`) had **zero accounting integration** until this pass — `invoice_no`/`dc_no`
were free-text fields with no FK to the real `sales_invoices` row, no freight cost field existed
anywhere despite the *inbound* (Procurement) side already tracking freight terms
(`purchase_orders.freight`), no e-way bill capture, and Dispatch had zero Report Engine entries while
every other department had at least one. Built per the user's explicit instruction to make the
necessary design calls without their input and demo the result.

**Decisions made (own judgment, flagged for the demo, not hidden as the only possible answer):**
1. **No new revenue-recognition trigger on dispatch** — under GST, the invoice (not delivery) governs
   tax timing (Rule 55 requires the invoice to accompany the movement); by dispatch time the invoice
   and its GL posting already exist. Dispatch needed *linkage*, not a second posting event.
2. **Freight cost, only when the company bears it, posts Dr Freight Expense (new code `5500`) / Cr
   Bank & Cash** — paid immediately, mirroring the Bank Reconciliation quick-JE precedent exactly.
   Swapping the credit side to Accounts Payable (if the real practice is paying the transporter on
   credit terms) is a one-line change to `dispatchFreightLines()`.
3. **Freight posting is a separate, explicit action** (`POST /api/packing/[id]/freight`), not a side
   effect of the generic packing-list PATCH — deliberately avoiding the exact bug class just found in
   RCM (§5ai): a state-changing update racing ahead of `postJournalEntry()`. `postJournalEntry()`'s
   own idempotency (existing-entry check by `source_type`/`source_id`) is the only "already posted"
   signal — no separate flag to drift out of sync.
4. **E-way bill: capture only**, no generation (needs a paid GSP, standing deferral since §5z/§7).
5. **No GTA reverse-charge GST on freight** — a real Indian tax nuance (freight paid to a transporter
   is frequently RCM-liable), deliberately not modeled, same class of stated simplification as the
   already-accepted Rule 42/43 ITC-reversal deferral. `dispatchFreightLines()` posts a flat,
   non-GST expense.
6. **One `sales_invoice_id` per packing list** — doesn't model a shipment split across multiple
   invoices; flagged, not built, absent evidence real shipments actually split that way.

**Built:**
- **Schema** (`lib/db.js`, additive `addColumn`) — `packing_lists.sales_invoice_id` (real FK,
  replacing reliance on the free-text `invoice_no` for anything that needs the actual invoice),
  `freight_amount`, `freight_paid_by` ('us'|'customer'), `eway_bill_no`, `eway_bill_date`,
  `dispatched_at` (stamped once on the first transition to `'dispatched'` — `updated_at` changes on
  every edit and can't answer "when did this actually ship", needed for the register below).
- **New account `5500` "Freight & Transportation Expense"** (`lib/ledger.mjs`) — backfilled onto both
  companies automatically via the existing `else` branch in `lib/db.js` (no new backfill code
  needed). New `dispatchFreightLines({amount})`, own selfcheck assertion in
  `scripts/ledger-selfcheck.mjs`.
- **`POST /api/packing/[id]/freight`** — reads the already-saved `freight_amount` (single source of
  truth for what's displayed vs. posted), rejects if `freight_paid_by !== 'us'` or no amount set,
  posts via the existing `postJournalEntry()`. Idempotent by construction.
- **`app/api/packing/[id]/route.js`** — new fields added to `EDITABLE`; a guard rejects (`409`)
  editing `freight_amount` once a `dispatch_freight` journal entry already exists for that packing
  list, pointing at Accounts' manual Journal Entry correction flow instead of silently accepting a
  number `postJournalEntry`'s own dedup would then never actually re-post; `dispatched_at` stamped on
  first dispatch in the same update.
- **`lib/data.js`** — `getPackingDetail()` gained a computed `freightPosted` flag (checks
  `journal_entries` directly, not a separate status column); `getSalesInvoices()` gained an optional
  `projectId` filter; new `getDispatchRegisterLines()`.
- **`GET /api/sales-invoices`** — widened to also allow Dispatch (previously only Sales/Marketing/
  Accounts — a `dispatch_head` calling it as originally planned would have 403'd), plus the new
  `?project_id=` filter so the packing-list invoice picker only lists that project's invoices.
- **New action** `dispatch.packing.freight` (`lib/action-permissions.js`).
- **UI** (`components/PackingDetail.jsx`) — e-way bill fields in the existing generic edit-field
  loop; a `freight_paid_by` Select and a `sales_invoice_id` Select (populated from the new
  project-filtered endpoint) alongside it; `freight_amount` becomes disabled once posted; a small
  card with a "Post Freight Expense" button, shown only when `freight_paid_by === 'us'` and an
  amount is set, hidden once posted (optimistic local-state update, no full reload).
- **Dispatch Register** — Dispatch's first-ever Report Engine entry (`app/api/reports/dispatch-
  register/route.js`, `lib/reports/render.js`'s `DISPATCH_REGISTER_COLS`/`dispatchRegisterTable`,
  `lib/reports/catalog.js`), visible to both Dispatch and Accounts (mirrors `vendor-bills`'
  cross-department read access). `dispatched_at` falls back to `updated_at` via `COALESCE` for any
  packing list dispatched before this column existed — a real approximation for historical rows, not
  a data claim, noted on the report itself.

**Live-verified against the real dev DB**, as `dispatch_head`/`accounts_head`: `npm run build` clean;
`dispatchFreightLines()` selfcheck passes; created a disposable test packing list under a real
project (17, Shanti Boilers), linked a real sales invoice (SB/13/2026-27), set a real freight amount
and e-way bill number, dispatched it (confirmed `dispatched_at` stamped), posted the freight expense
— the JE posted exactly Dr Freight Expense 4,500 / Cr Bank & Cash 4,500, Trial Balance moved by
exactly that amount both sides (8,645,209.67 → 8,649,709.67). Re-posting returned the same journal
entry id (idempotency confirmed, no duplicate). Editing `freight_amount` after posting correctly
rejected with `409`. The Dispatch Register report rendered the shipment correctly with the right
totals, visible to both `dispatch_head` and `accounts_head`. `GET /api/sales-invoices?project_id=`
correctly returned only that project's invoice for a `dispatch_head` caller (previously would have
403'd). Clicked through the actual `PackingDetail` UI — freight card, disabled amount field with the
correction message, linked-invoice Select, e-way bill fields all rendered correctly. That first test
packing list was then deleted and Trial Balance confirmed back to exactly 8,645,209.67 — zero residue
— before recreating a second, permanent example (`PL-1009`, customer name tagged "(safe to ignore)")
left in the database for demo purposes, per instruction (see `4.5-DATA-INVENTORY.md`).

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
projects ──< tasks                               (§3a/§3b — every department's to-dos AND cross-department raises; project_id optional, null for Operations-level asks)
milestones ──< notifications                     (§3b — a handoff/reopen notification's milestone_id; notifications fan out one row per recipient)
tasks ──< notifications                          (§3b — a cross-department task raise's task_id, the other notification link target)
tickets                                          (§3b — dead, kept only for notifications.ticket_id FK + pre-collapse history; nothing reads/writes it)
milestones ──< milestone_stages                  (§3c — one row per stage per milestone instance, status Open/Current/Closed)
stage_templates ──< stage_template_items         (§3c — named, reusable per department + milestone_key; one is_default auto-copies at project creation)
suppliers ──< supplier_quotes                    (§5c — provisional supplier list; append-only price-history log, per item per supplier per timestamp)
suppliers ──< purchase_orders ──< po_items        (§5c — a PO can span projects; po_items snapshots bom_items at PO-creation time)
bom_items.selected_quote_id → supplier_quotes    (§5c — the winning-quote pointer; NULL = still needs sourcing)
projects ──< procurement_requests                (§5c — a new-item request from Engineering/Design; not a bom_items row until accepted, bom_item_id set on acceptance)
employees ──< attendance_days                    (§3a — the one attendance system now; workers/worker_days retired, migrated then dropped)
milestones ──< job_cards ──< job_card_time_logs  (§5g — the shop-floor execution unit; time_logs is employee_id + minutes/from_time/to_time, multi-session)
job_cards ──< job_card_consumables               (§5g — welding rods/gas/discs, free text, no price)
job_cards ──> job_cards (rework_of, self)        (§5g — QC-fail/rejected-qty rework lineage)
bom_items ──< material_issues                    (§5g — structured Stores/Production→WIP consumption, job_card_id optional)
inventory_items ──< inventory_reservations       (§5e — Reserve/Issue two-step; qty commits against `available`, on_hand untouched until Issue)
bom_items.inventory_item_id → inventory_items    (§5e — set once a reservation issues, or a source='stock' item materializes against a named line)
gate_passes ──< gate_pass_items                  (§5e, 2026-08-19 — Returnable/Non-Returnable Gate Pass; item list is free text, no inventory_item_id link)
gate_inward_receipts                              (§5e, 2026-08-19 — standalone gate/security log; grn_ref is free text, no FK into bom_items/purchase_orders)
operations / workstations / trades               (§5g/§3a — flat masters; workstations carries machine_hour_rate, employees.trade_id-equivalent is the free-text `employees.trade` validated against `trades`)
work_orders ──< work_order_operations             (§5l — the Process Route Card; operation_id/workstation_id/milestone_id all optional pointers into existing masters)
work_orders ──< work_order_materials               (§5l — bom_item_id link for against_order, or its own item_id/description + manual qty_issued for against_stock)
work_orders ──< work_order_change_notes           (§5l — field/old/new/reason, the only path to move a released Work Order's baseline)
work_orders ──< job_cards (work_order_id, work_order_operation_id, both optional)  (§5l — generated execution records; job_cards.project_id is nullable for against_stock Work Orders with no project)
work_orders ──> projects / sale_orders (project_id, sale_order_id, both optional)  (§5l — against_order vs. against_stock)
sale_orders ──< projects                          (company decided at the Sale Order — the commercial commitment — and copied onto the project at creation; projects.company is the denormalized read)
users (role + departments CSV + project_ids CSV [customer scoping, one-or-more] + pending flag)
app_settings (key/value)                          (§5e, 2026-08-20 — one global row so far: stores_allocation_mode = auto/manual; not a settings subsystem, same "smallest thing that works" precedent as `counters`)
```

`bom_items` carries the spreadsheet-mirror columns — `section` (sheet), `group_label` (assembly
heading), `make`, `qty_text`, `purchase_status` (PENDING/TRANSIT/CLOSED/RECEIVED/CANCELLED — the
last added this round, §5a), and free-text
refs `pr_ref`/`po_ref`/`grn_ref`/`grn_qty_text`/`pending_qty_text`/`bqtc_ref`/`issued_ref`/
`received_ref`/`remarks`, plus `import_id → bom_imports` (null = pasted/added in-app). All refs
are deliberately free text (the cells mix numbers, dates and codes); only `purchase_status` is
normalized, and rollups count nothing else.

Milestones carry: assignee, department, planned/actual dates, status, delay category + reason,
vendor/PO/material-ready/QC flags, notes, a **dormant `depends_on_key`** for a future
dependency/critical-path layer, and **`reopened_at`/`reopen_reason`/`reopened_by`/`reopen_count`**
(§3b — set by `POST /api/milestones/[id]/reopen` when a milestone that was already Closed is sent
back; `reopen_count` feeds the notification `dedupe_key` so a redo-and-reclose cycle notifies
downstream again, unlike the old ticket-based flow's `source_key` UNIQUE limitation; cleared
implicitly whenever `actual_end` is next set on re-close except `reopen_count`, which only grows).
`tasks` carries `from_department` (set only on a cross-department raise, null for a department's own
board items — the signal `notifyDepartment` fires on), `project_id` (optional context), and
`bom_item_id` (§5a — set only on a Procurement cancel-request; by construction, a task with this set
*is* a cancel-request, no separate `kind` column). All added via the standing `addColumn()`
migration helper in `lib/db.js`, not one-off `ALTER TABLE`s.

**Multi-company (§5g), added this round:** `employees.cost_rate_per_hour` (labor costing) and
`employees.company` (which entity employs this person — payslip's own axis, distinct from a
project's) are both HR-owned, API-editable (`PATCH /api/employees/[id]`); no dedicated HR form
field for `company` yet. `sale_orders.company` is the source of truth (set on both creation paths —
direct create and the quotation→convert flow — and editable after the fact); `projects.company` is
copied from it at project-creation time, defaulting to Shanti Boilers only for a project created
without a sale order. Existing pre-migration rows were backfilled by this system's own documented
rule (`STF-` project-number prefix → Shanti Techno Fab, §5d) rather than a blanket default.

## 8. Operations-platform deferred items

Dependency graph / auto critical-path (`depends_on_key` column in place), an **activity feed UI**
(the underlying data now exists — `usb_audit`, §16 — just no page renders it yet), file/photo
uploads (the PMB blob in §5a is the only stored file — there is still no general document store),
barcode/QR validation at dispatch, email/WhatsApp notifications, and the §5a "deliberately not
built" list (drawings/IBR document management, BOM release workflow, Excel export, in-app BOM
authoring, supplier analytics). Installation and Design still just get their milestone list; QC now
has its own test-record module (§5b); Procurement/Stores/Production have the Master BOM.

**Cross-department signals (§3b), next up:** notify-the-original-raiser when their raised task is
marked done, and overdue-task notifications — both named next, no new schema needed. The old
re-notify-on-redo-and-reclose limitation is **fixed** (§3b) — not listed here anymore. **Workflow
Stages is built** (§3c) — no longer listed here. **BOM-received / QC-fail notification triggers are
built** (§3b, 2026-08-21) — no longer listed here.

**Also deferred:** a PM-oversight cross-department view for the Tasks calendar (§3a — PMs currently
have no Tasks tab at all, same as before); the multi-department "combined heads" dashboard for
Operations, deferred until a head actually running two-plus departments exists; and reorganizing
Production's milestones into new dedicated Production quality/inspection/testing milestones
(distinct from Stages, and from QC's existing module) — still parked, but the "is the 7-phase idea
real" half of this is now answerable: Production can model it as Stages under its existing granular
milestones the same way any other department would, no schema change needed, whenever
`production_head` actually defines them. **Template editing is built** (§3c, named/multi-template
model with a Manage-tab editor) — no longer listed here.

**Operations-tab and project-page redesign — Procurement's pass is done, the general one is still
under discussion.** Both surfaces had accreted cards across several rounds (Master BOM, per-project
attention lists, Stuck-in-Production, Waiting-on-per-department, and Stages, all stacked on top of
the milestone list on the project page; a similar stack on Operations) with no pass on which are
department-level vs PM-level, which actually get used, and which should collapse or merge. The
Procurement redesign (§5c) did this for Procurement specifically — and two of its changes turned out
to apply globally rather than being scopable to one department (see §5c): **Waiting-on is now gone
everywhere**, not just for Procurement (the redundancy argument held for the whole app — only one
milestone total has ever had a `delay_category` set), and **"Needs Attention" → "Open Actions"**
(Urgent/Needs-attention split) is the same shared card/component every department sees, not a
Procurement-only view. What's still genuinely Procurement-specific and hasn't touched any other
department: the plain BOM table and Tickets/Raise card are gone from Procurement's own project-page
section only. The still-open half of this paragraph is the PM action-queue/Manager-flow/Head-queue
redesign proper (which cards to collapse or merge for the *other* departments) and fixing
`TicketsPanel.jsx`'s default title, still literally "Tickets" where no department overrides it —
cosmetic only, the backing entity has been gone since §3b.

**Production Job Cards (§5g), built this round** — no longer listed here as deferred. What's left,
genuinely small: no HR form field to set an individual `employees.company` (API-editable only); no
way to pre-assign a worker to a job card before they log hours (matches ERPNext's own model, left
alone on purpose, not a regression); and the Workers Roster's inline trade-edit dropdown only picks
up a trade added via `QuickAddInline` after a page refresh, not live in the same session.

**Production's next layer — manufacturing intelligence + boiler-specific traceability (2026-08-19,
none of this built).** With Work Orders (§5l) landed, Production has a real, coherent
production-control lifecycle (BOM readiness → Work Order → route → Job Cards → execution →
QC/rework → completion, plus costing/forecasting/change-control around it) — the gap left isn't more
generic ERP surface area, it's the deeper control/intelligence layer a manufacturing ERP eventually
needs, sharpest for a boiler/pressure-equipment fabricator specifically. Roughly in priority order,
each noting what already exists as a seed to extend rather than starting cold:
1. **Finite production scheduling + capacity/bottleneck management.** `getProductionForecast()`
   (§5l) already flags a workstation `overloaded` against a flat single-shift assumption — real,
   but a look-ahead glance, not a scheduler. There's no "what should run next, on which machine,
   given everything else queued" engine, and no answer to "what's actually blocking this late Work
   Order" beyond reading its route card by hand.
2. **Material shortage / availability pegging.** Forecast's `materialDemand` already shows
   outstanding quantity per material across open Work Orders — the missing half is
   available-vs-ordered-vs-shortage per line, and which specific projects/Work Orders a shortage is
   blocking. Procurement/Stores own the purchasing side; Production needs the impact view.
3. **Formal Quality: NCR / disposition / ITP.** `qc_records` (§5b/§5g) covers freeform tests, MTC,
   radiography, and Hydro Test (`result`: pending/pass/fail) with rework lineage on a fail — real,
   but there's no formal non-conformance record, no disposition path beyond rework (repair/scrap/
   use-as-is aren't modeled), no inspection/test-plan checkpoints tied to a route step, and no
   hold/release gate.
4. **Material heat/lot traceability.** `stock_pieces` (§5k) already gives a real piece-level
   traceability chain — `PL-0007` → `-U1`/`-R1`/`-S1` (used/remnant/scrap) — but there's no heat/lot
   number field, and no automatic link from a cut piece back to its Test Certificate (§5d's
   certificate bank is a manual, not automatic, link today). For pressure equipment this is a real
   gap, not a nice-to-have.
5. **Welding/fabrication traceability.** A Job Card's `operation_id` can tag "Welding" generically;
   there is no per-joint weld ID, no WPS/welder-qualification record, no consumable-batch link, and
   no NDT-to-joint linkage — welding is currently "Job Card = Done," not a manufacturing history.
6. **Subcontract / outside-process control.** `job_cards.is_outside`/`outside_vendor` (§5g) is a
   flag, not a workflow — no tracked quantity sent, expected-return date, actual receipt, or vendor
   cost (§5l's own costing section already notes outside job cards are listed, never priced).
7. **Machine maintenance / downtime / OEE.** `workstations` (§5g) carries a name and
   `machine_hour_rate`, nothing else — no availability calendar, maintenance schedule, breakdown
   log, or OEE rollup.

Deliberately not attempted as a batch of new sidebar tabs — the same "primary lifecycle vs.
supporting/control layer" split §5l's relaunch just applied (Route/Operations, Material, Labour,
Costing, Forecast, and Change Notes all sit as indicator chips around the lifecycle, not stages in
it) is the shape any of the above should take too, whenever picked up.

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
- **People** (live, PM-only) — pending registrations + onboarding roster, `PeoplePanel.jsx` (§2a).
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
  a Bearer header carrying `role:'agent'` + `machine_id` (the Windows agent). Human API routes
  re-check the active/pending user row on every request, so deactivation and permission changes
  take effect immediately; the JWT is only the signed session locator. Production requires an
  explicit `SESSION_SECRET` and human sessions expire after 12 hours. See §12.
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
`handoff.test.mjs` (§3b, the pure handoff rule + its `node --test`, unchanged by the tickets
collapse), `notify.js` (§3b, formerly `tickets.js` — notification fan-out + `fireHandoff`, no
longer creates any row besides the notification itself), `beep.js` (§3b, WebAudio chime, no audio
file), `po-pdf.js` (§5c, the Purchase Order PDF — exact mirror of `packing-pdf.js`).
`app/` — pages + API routes, including `/` (Home/Tasks calendar), `/ops` (Operations dashboard),
`/projects` (shared Projects), `api/agent/*` (Bearer-agent), `api/usb/*`, `api/browser/*`
(session-cookie, PM-gated), `api/qc-records/*` (§5b, QC + PM-gated), `api/milestones/[id]/reopen`
(§3b, the send-back-for-rework endpoint), `api/milestones/[id]/stages` + `api/milestones/[id]/stages/
[stageId]` (§3c, add/apply-template and rename/status/delete on a milestone's own instance),
`api/stage-templates/*` (§3c, the named-template CRUD — header + `.../items/*`),
`api/production/tasks/accept-cancellations` (§5a, Procurement's bulk cancel-request accept),
`api/suppliers/*`, `api/supplier-quotes`, `api/bom-items/[id]/select-supplier`,
`api/purchase-orders/*` (+ `/[id]/pdf`) (§5c, the Procurement system's CRUD — all gated
`requireDepartment(user, 'Procurement')`), and `api/notifications`. `app/procurement/page.js` (§5c,
the cross-project workspace — gated like `app/production/workers/page.js`, no calendar/date params
needed). `app/login/page.js` /
`app/d-login/page.js` (§2c) are the production sign-in page and the gated demo picker;
`app/production/*` (§3a, Tasks + Workers — route name is legacy, Tasks now works for every
department, verified live) is gated by `isHead`/`headDepartments` (any department) except Workers,
which stays `inDepartment(user, 'Production')`. There is no `app/tickets/*` — never was in this
round's model either; cross-department tasks live inside `app/ops/page.js` (Operations) and the Tasks
calendar (§3a/§3b); `app/notifications/page.js` is the bell's "View all" destination, not in nav.
`app/layout.js` is also where the device-setup gate lives (see §2a) — every page renders through it.
`components/` — nav, project/milestone/packing UI, settings forms, `DevicesPanel` /
`BrowserPanel` / `PeoplePanel` / `TotpSetup` for the Approvals tab, `QcPanel.jsx` (§5b),
`DeviceSetupGate.jsx` (§2a), `InfoPopover.jsx` (§2b, contextual help), `help-content.jsx` (the
role-aware `/help` guide content — plain data, no CMS, also feeds `InfoPopover`),
`ProductionToday.jsx` / `WorkersPanel.jsx` (§3a), `NotificationBell.jsx` / `TicketsPanel.jsx` (§3b —
`TicketsPanel.jsx` kept its name across the tickets collapse; it's the cross-department
task/reopen panel now, not a literal tickets list, and its `RaiseDialog` is also where a
cancel-request against a BOM item gets raised, §5a), `StagesPanel.jsx` (§3c, the Kanban/Manage
Stages card — native HTML5 drag-and-drop, no library), `ProcurementQueue.jsx` (§5a, Procurement's
own Sourcing/PO-placed/In-transit worklist + cancel-requests accept action, mounted above the BOM
table on their department panel only, with a link into the workspace below),
`ProcurementWorkspace.jsx` (§5c, the `/procurement` page's 5-tab client component — Sourcing,
Selection, Purchase Orders, Status, Suppliers).
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

The repository naming convention is documented separately in
[docs/PROJECT-STRUCTURE.md](docs/PROJECT-STRUCTURE.md). Existing product-spec filenames and the
`/production` route are retained as compatibility-sensitive historical names; new source files
should use lowercase kebab-case for documents and domain-oriented names for code.

## 20. Run

```bash
npm install
npm run lint        # dependency-free JavaScript syntax check
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



### Resolved hardening notes (2026-08-15)

- Project creation now uses one database transaction for the project, milestone chain, and initial
  Scope of Supply. Notifications and audit remain best-effort side effects after commit.
- Human API routes use a fresh active/pending user lookup rather than trusting stale JWT role
  claims. The project picker also scopes customer results to the customer's own project IDs.
- Procurement stage summaries share `derivePurchaseStage()` in `lib/bom-fields.mjs`; the project
  queue now accounts for quote counts and selected suppliers while preserving explicit terminal and
  Comparison states. `lib/pmb-selfcheck.mjs` covers these signal combinations.


### Prevention

`purchase_status` remains an editable operational field, so it may lag behind quote and supplier
signals by design. All summary views must use the shared `derivePurchaseStage()` helper; the raw
field remains appropriate only for the Status tab's literal display/edit path. The PMB self-check
now includes explicit Comparison, quote-count, and selected-supplier cases to prevent another
consumer from silently reintroducing raw-column bucketing.
