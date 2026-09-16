# Project View Redesign — Findings & Ideas

**Status:** research only — nothing built yet. Kept as the working record while this is
investigated and (eventually) designed, same lifecycle `PROCUREMENT-CHANGES.md`/`QC-CHANGES.md`
went through: fold the as-built result into `SYSTEM.md` once shipped, mark this file done.

**Purpose:** the Project View page (`/projects/[id]`) has accreted panels across many rounds with
no single pass asking which belong there vs. on a department's own main-tab workspace, and no way
today to see, in one place, everything that's accumulated against a project as it moves through
departments (invoices, POs, approvals, NCRs, service calls, etc. — real records, real `project_id`
links, just never surfaced there). This doc is that pass: an exact map of what's on the page today,
department by department, checked against each department's own main-tab workspace for real
overlap (not assumed), a feature-parity verdict for the two places overlap turned out to be real,
and options for the accumulating-document idea.

**Related, narrower, earlier doc**: `DESIGN-OPS-REDESIGN.md` covers a Design-only pass over the
Operations page and project-page Design panel from an earlier round (Activity feed, "Currently
With" card, Stages/Kanban decisions) — several of its items are already shipped per the current
code (confirmed while researching this doc). Not merged into this file; read it separately if
picking up loose ends from that round specifically. This doc is the cross-department one.

**Everything below is verified against the actual files on disk (2026-09-14), not from memory or
SYSTEM.md's own prose** — where it contradicts SYSTEM.md, that's called out explicitly rather than
silently corrected.

---

## Part 1 — Current state (verified)

### 1.1 Project View page layout (`app/projects/[id]/page.js`)

Same order for everyone (customers are redirected away before this renders):

1. **`PortfolioDelayTimeline`** — the milestone tracker, full width, scoped to this one project.
   Read-only context for every role, including heads.
2. **3-column row**: `ProjectHeader` (identity/status) · `TodayBand` ("Open Actions" — this
   project's own overdue/blocked/due-soon milestones, scoped to a head's own department, unfiltered
   for a PM) · a "Currently With" card (`DepartmentPills` + `DepartmentProgress`, computed via
   `activeDepartmentStatus` — **not** a BOM rollup; this replaced an old "Design chip or BOM
   rollup" guess, per the code's own comment).
3. **`ChildUnitBomCard`** — only when `project.master_project_id` is set (this page IS a split
   child). Read-only, department-agnostic, client-fetched from `/api/projects/[id]/child-bom`.
4. **Batch panels** — only when `hasChildren` (this page is a **master** that's been split) AND the
   viewer has the relevant department access: `ProductionBatchJobCardPanel`, `QcBatchDocumentPanel`,
   `DispatchBatchPackingPanel` — batch-create tools for the master's children. These are separate
   from `DepartmentPanel`, not part of the per-department section below.
5. **Department section** — `ProjectDepartmentTabs` (PM: a tabbed strip, one `DepartmentPanel`
   mounted at a time, red `!` badge on any dept with an overdue/blocked milestone, `?dept=` deep-link)
   or stacked `DepartmentPanel`s, one per granted department (functional head, no tabs).

**Confirmed NOT on this page at all, despite being plausible candidates**: `AllocationPanel` and
`ChildRoutingPanel` — a code comment says they "moved to Stores' own Allocation & Routing tab
(`/stores`)" already. `NcrPanel` (the full register), `QcHoldPanel`, `MaterialApprovalPanels`
(Inward/Pre-Dispatch approvals) — never imported anywhere in this page's component tree.

### 1.2 Per-department panel contents (`components/DepartmentPanel.jsx`)

Every department except Procurement gets **`TicketsPanel`** ("Incidents") first. Its Raise dialog
offers exactly two kinds, both already correctly scoped — **no BOM-item-cancel option exists inside
TicketsPanel** (that's `BomTable`'s own separate Cancel button for Design/Engineering, a different
mechanism; some older docs implied TicketsPanel had a third "cancel BOM item" raise-kind — it does
not, confirmed by reading the component directly):
- **Task** — cross-department raise (`POST /api/production/tasks`), any target department,
  title/body/mentions/due date.
- **Send back (rework)** — reopens an already-closed milestone in the target department
  (`POST /api/milestones/[id]/reopen`), shown only when a closed milestone exists there.

| Dept | Panels rendered (beyond Tickets + Milestones/Stages) | Real actions |
|---|---|---|
| **Design** | `DesignPanel`, `BomPanel` (full) | Approve Design button (`isDesignHead` gated, PATCHes `design` milestone); Calc Sheets card (read-only, deep-links to `/calc/project/[id]`); Drawings card (read-only status list); collapsible 5-item Activity feed; embeds `ScopeOfSupplyPanel`. `BomPanel`: full .xlsx/CSV import + preview/revision history, paste-rows fallback, `BomTable` scoped to Design's edit rights — Design owns no `BOM_FIELD_OWNERS` columns, so its only real write action on the table is the **Cancel** button (Design is in `CANCEL_DEPARTMENTS`). |
| **Engineering** | `ScopeOfSupplyPanel`, `BomPanel` (full) | SOS: edit header, add/edit/delete priced lines, Release (draft→released), PDF export, "Add work order." BOM: full CRUD (structured Add-Item composer, catalog search, category-driven dimensional fields, traceability flags), Link-to-Item-Master, **Cancel** button (Engineering also in `CANCEL_DEPARTMENTS`). |
| **Procurement** | `ProcurementQueue` only — **no Tickets card either** | **Nothing editable.** Read-only item count + `BomStageBar`/legend + one "Open Procurement workspace →" link to `/procurement`. Already deliberately stripped down — a comment confirms the old cancel-request/accept-cancellation flow is retired (dead route left in place, unused). |
| **Stores** | `BomTable` directly (a "Master BOM — Stores" card) | Stores' own editable-field scope, plus the Receive dialog (`ReceiveBomItemDialog`) in place of a free-text GRN field. No separate wrapper component beyond the raw table. |
| **Production** | read-only "Approved Drawings" card, `BomTable`, Hydro-Test `QcPanel` | Drawings card: file-download links only, no action. `BomTable`: Production's edit scope + the **Prod. Done** checkbox (gates Dispatch packing eligibility). `QcPanel` (title "Hydro Test", `defaultTestType="Hydro Test"`, carries `reworkMilestoneId`): add/edit/delete hydro-test rows, Pass/Fail/Pending, **"Create rework card"** on fail, **"Raise NCR"** on fail. Confirms hydro-test ownership genuinely sits with Production, not QC, even though it's the same `QcPanel` component. |
| **QC** | 4× `QcPanel` instances (General, "Incoming Inspection", "Finished Goods Inspection", "Subassembly Inspection"), `JobWorkPanel`, `QcProjectSummary` | Each `QcPanel`: add/edit/delete a `qc_records` row, Pass/Fail/Pending toggle, **Raise NCR** on fail (all four instances). "Finished Goods Inspection" additionally gets a `dispatch_eligible` toggle (`showDispatchToggle`) and a Work-Order `linkField`. "Subassembly Inspection" gets an Assembly `linkField`. None of the 4 QC-tab instances carries `reworkMilestoneId` — that's Production-tab-only. `JobWorkPanel`: add/edit/delete job-work-inspection records (worker, sent/received qty+dates, pass/fail, auto-computed variance). `QcProjectSummary`: **entirely read-only** — a TC/statutory-doc count rollup with two "Manage" buttons that deep-link to `/qc?tab=tc-bank&project=` and `/qc?tab=docs&project=`; no inline CRUD of any kind here. |
| **Dispatch** | `PackingPanel` | **Generate Draft Packing List** from pending BOM lines (`POST /api/packing/from-bom {project_id}`), redirects to `/packing/[id]`. **"Pending PDF"** export link (`/api/projects/${id}/pending-pdf`). List of this project's own packing lists (`getProjectPackingLists(projectId)` — strict `WHERE pl.project_id = ?`, every status including draft), each linking to `/packing/[id]` for the real pack/dispatch workflow. |
| **Installation** | `InstallationMilestoneActions` (fully replaces the generic `MilestoneBoard`/`StagesPanel` block) | One "Mark complete" button per target milestone (`site_installation`/`commissioning` only; `canPerformAction(user,'Installation','installation.milestone.complete')` server-gated), PATCHes straight to done — bypasses the generic `MilestoneDrawer` entirely. Comment: chosen because neither milestone has any other real data signal to auto-infer completion from. |
| **Sales / Marketing / HR / Accounts** | **No branch exists at all** | Nothing beyond Tickets (and even that only if they somehow had milestones, which they don't in practice — `DepartmentPanel` has zero code path for these four). |

Every department whose `deptMs.length > 0` also gets `MilestoneBoard`→`MilestoneCard`→
`MilestoneDrawer`, and `StagesPanel` (a Kanban of Open/Current/Closed "stage" checklist items
nested under each milestone, plus a Manage tab for PM/heads: add/rename/remove stages, save/apply
reusable per-department-and-milestone-key templates, set a default).

### 1.3 Milestone Drawer — who can do what

- **Functional head** → reduced form: read-only schedule, exactly two buttons — **Start**
  (`status: in_progress`) and **Close** (`status: done`; closing late first prompts for a delay
  category/reason). Cannot touch assignee/department/dates/vendor-PO/QC-ok flag/notes directly.
- **PM** → full edit: assignee, department, status, all four dates, category-conditional fields
  (Vendor/PO/"Material ready" for `procurement`-category milestones, "QC passed" for `qc`-category),
  delay category/reason, notes. Single Save, one PATCH.
- **PM-only "Bulk edit"** toggle on `MilestoneBoard` swaps the card grid for `MilestoneGrid` —
  spreadsheet-style inline editing per row, each cell PATCHes independently on blur/change.

### 1.4 Each department's own main-tab workspace — overlap with Project View

| Dept | Has a project picker/drill-in on its own main tab? | Relationship to Project View's section |
|---|---|---|
| Engineering (BOMs/Release BOM) | Yes — single-project header `SearchableSelect` | Complementary — a richer tree view of the same `bom_items`, not a duplicate of `BomPanel`'s flat table |
| Engineering (Where-Used/Common-Uncommon/Change Notes) | Multi-project checkbox filter, not a single drill-in | No Project View equivalent at all — genuinely new surfaces |
| Calc Sheets (`/calc`) | Yes — picker landing page → per-project sheet list | No Project View equivalent (Design's card only links out, no calc content inline) |
| Drawings (`/calc-drawings`) | Yes — single-project picker, reuses the exact same `DrawingsPanel` Calc Sheets uses | No Project View equivalent — Design's/Production's inline drawing cards are read-only, much narrower |
| Procurement (`/procurement`) | No — a `project_no` text filter on Enquiry/Selection only, not a real drill-in | No meaningful overlap (Project View's Procurement section is already a bare summary) |
| Stores — Allocation & Reservations | Yes — cross-project queue → "Manage" → per-project `AllocationPanel` + `ChildRoutingPanel` | **No Project View equivalent** (already moved off the project page entirely) |
| Stores — Issued to WIP | Yes — inline project `Select` → BOM item picker → log issue | No Project View equivalent |
| Stores — Material Demand / Material Indents | No — cross-project queues, text-searchable | N/A |
| Production — BOM tab | Yes — project `Select` | Different, richer content than Project View's Production BOM slice (fabrication %, Raise Indent, cutting/remnant dialog) |
| Production — Work Orders / Job Card | Filter + project field on the create form | N/A |
| **QC (`/qc`)** | Yes — one shared header picker scopes Test Certificates/Documents/NCR tabs | **Real overlap — but only for certs/documents**, see 1.5. The test-record log (`qc_records`) itself has zero presence on `/qc` at all. |
| **Dispatch — Pending Items** | Per-project-group action button, no picker | **Real overlap** for "Generate Draft Packing List" specifically (identical route). Everything else in `PackingPanel` (Pending PDF, per-project history) has no equivalent on `/dispatch`, see 1.5. |
| Installation | No — project is only an optional field on the create form, no drill-in | Service Calls/Contracts are a genuinely new entity (post-installation service), not overlapping `InstallationMilestoneActions` |
| Sales | A per-row "Costing" dialog only, no picker/list | No Project View equivalent (Sales has no `DepartmentPanel` branch) |
| Accounts, HR | None (confirmed via grep — zero `project_id` matches in either workspace) | N/A |

### 1.5 The two real duplicates — feature-parity verdict (verified, not assumed)

Strip-to-read-only-plus-deep-link is the right instinct *only if nothing real is actually lost* —
checked directly against the code before concluding anything either way.

**QC — stripping would lose real capability.** `/qc`'s workspace (`QcWorkspace.jsx` and everything
it renders — `TcBank`, `MaterialCertificatePanel`, `StatutoryDocsPanel`, `CalibrationPanel`,
`NcrPanel`, `QcHoldPanel`, the Approvals panels) **never imports `QcPanel` and never references
`qc_records` at all.** Concretely, if the 4 project-page `QcPanel` instances + the Production-tab
Hydro Test instance + `JobWorkPanel` were stripped to read-only:
- **Lost**: adding/editing/deleting a `qc_records` row (any test type — general, incoming, finished
  goods, subassembly, hydro), the Pass/Fail/Pending toggle, "Create rework card" on a failed hydro
  test, "Raise NCR" on any failed test row. No page reachable from `/qc` does any of this.
- **Lost**: Job-Work Inspection entirely — `job_work_inspections` has zero screen anywhere off the
  project page.
- **Safe** (already fully reachable via `QcProjectSummary`'s existing "Manage" links):
  TC add/edit/link/PDF at `/qc?tab=tc-bank&project=`; statutory document add/edit/finalize at
  `/qc?tab=docs&project=`.

**Dispatch — stripping would also lose real capability, though less of it.**
- **Safe**: "Generate Draft Packing List" — `DispatchWorkspace.jsx`'s Pending Items tab calls the
  identical `POST /api/packing/from-bom {project_id}`.
- **Lost**: the "Pending PDF" export (`/api/projects/[id]/pending-pdf`) — grepped the whole repo,
  the only UI reference to that route is `PackingPanel`'s own link; nothing on `/dispatch` offers it.
- **Lost**: viewing one project's own complete packing-list history (every status, including draft)
  — `DispatchBoard`'s kanban has no project filter at all; `DeliveriesTab`/`DocumentsTab` only do a
  free-text `customer_name`/`packing_no` substring search and are additionally restricted to
  `packed`/`dispatched` (drafts never show there). A customer with several orders would even get
  mixed results from a name search.

### 1.6 The "accumulating documents" gap

`getProjectDetail(id)` (`lib/data.js:187-239`) is a thin rollup:
`{project, milestones, health, blocker, progress, currentPhase, nextPhase, estDispatch, hasChildren}`
— `project` is a bare `SELECT * FROM projects`, no joins. Every other panel on the page (BOM,
packing, QC, design, scope of supply, tasks, stages) is fetched separately by the page component,
not bundled into one aggregator.

**No project-wide, cross-table document/activity trail exists anywhere in this app today.** The
closest precedents, all checked directly against their real code:

1. **Design's own 5-item activity feed** (`getProjectDesignSummary()`, `lib/data.js:1796-1829`) —
   explicitly commented *"a glance card, not an audit log."* Exact merge shape:
   ```js
   const activity = [...snapshotEvents, ...drawingEvents, ...noteEvents]
     .sort((a, b) => (b.ts || '').localeCompare(a.ts || ''))
     .slice(0, 5);
   ```
   Only 3 event kinds (`calc_snapshots` saves, `calc_drawing_files` uploads, `calc_notes`), capped
   at 5 total, Design-only, done in JS not SQL.
2. **The Customer Portal's `getCustomerView(projectId)`/`getCustomerViewSplitOrder()`** already
   fetches, per project: `packing_lists` (`WHERE project_id = ? AND status != 'draft'`, every
   past-draft row, newest first), `sales_invoices` (`status != 'draft'`), `qc_documents` (`WHERE
   customer_visible = 1`), drawings via `getCalcDrawings`. **Correction to what SYSTEM.md's §6
   prose implies**: these are **not** grouped by phase in the data layer — `lib/data.js` returns
   three flat, parallel arrays with no `phase` field on any row. "QC Certificates and Packing Lists
   nest under their real phase" is true only of the *rendered UI* — `components/
   PortalOrderProgress.jsx` does the nesting itself, via a hardcoded, 3-entry map:
   `phaseDocs = { design: items.length, testing: qcCertificates.length, packing:
   packingLists.length }`. There is no general phase-grouping mechanism to reuse as-is. The query
   *shape* is still directly reusable though: independent, already-project-scoped `Promise.all`'d
   queries, one per table — several of the currently-invisible tables below already have a
   project-scoped getter sitting in `lib/data.js` ready to reuse (`getQcRecords`,
   `getJobWorkInspections`, `getScopeOfSupply`, `getTestCertificates(projectId)`,
   `getEngineeringChangeNotes(projectId)`).
3. **A stronger, more scalable precedent than either of the above: the three ledger functions**
   `getCustomerLedgerLines`/`getStockLedgerLines`/`getVendorLedgerLines` (`lib/data.js`,
   ~4836-4990) — each does a real SQL `UNION ALL` across 2-3 record types, tagging each row with a
   `kind` column and an explicit `sort_rank` column for tie-breaking (SQLite forbids a `CASE`
   expression directly inside a compound query's `ORDER BY`), then `ORDER BY date, sort_rank` —
   done entirely in SQL. The cleanest "several record types, one correctly-ordered feed" pattern in
   the codebase; would scale better than Design's in-memory approach for a trail spanning many
   tables.
4. **Grouping key**: every `MILESTONE_TEMPLATE` row already carries a `department` field (the same
   `DEPARTMENTS` enum used everywhere else internally — nav, exec dashboards, access matrix) — a
   more natural grouping key for an internal, PM/head-facing document view than `CUSTOMER_PHASES`
   (customer-facing business language: "Design & Engineering," "Quality Testing"). `CUSTOMER_PHASES`
   stays the right choice only for anything actually customer-facing.
5. **`usb_audit`** — confirmed via direct schema read: `id, request_id, machine_id, actor, action,
   detail, created_at`. **No `project_id` column, no FK chain to one.** Purpose-built for USB/
   browser device-approval logging only. Not a general write-audit log — cannot be filtered by
   project without a schema change.

At least **10 real, `project_id`-scoped record types are never shown anywhere on the Project View
page today**:

| Table | project_id scoping | Currently visible on Project View? |
|---|---|---|
| `sales_invoices` | direct | No |
| `purchase_orders`/`po_items` | direct on `po_items` (denormalized; a PO itself can span projects) | No |
| `vendor_bills` | one hop via `po_id` → `purchase_orders` | No |
| `journal_entries` | indirect via `source_type`/`source_id` | No |
| `inward_approvals` | direct | No |
| `pre_dispatch_approvals` | direct | No |
| `material_indents`/`material_indent_items` | direct (nullable) | No |
| `ncr_records` | direct | No |
| `service_calls`/`service_call_visits`, `service_contracts` | direct (nullable) | No |
| `job_cards` | direct (nullable for against-stock work orders) | Only indirectly, and only for split-master projects (`ProductionBatchJobCardPanel`) |
| `test_certificates`/`certificate_projects` | many-to-many junction | Only inside the QC document editor sub-page, not the main project page |
| `gate_passes`/`gate_pass_items`, `gate_inward_receipts` | **no `project_id` column at all** | Structurally cannot be shown per-project without a schema change |

### 1.7 Corrections vs. earlier assumptions / stale docs

- `AllocationPanel`/`ChildRoutingPanel` are **already** off the Project View page — moved to
  `/stores` in an earlier round. This is a real precedent for "move to the main tab," already done.
- Procurement's Project View section is **already** stripped to a bare read-only summary + link —
  another real precedent already in place, and the cancel-request flow that used to live there is
  fully retired.
- `TicketsPanel` has no BOM-item-cancel raise-kind (only Task / Send back). If any older doc implies
  a third kind, that's stale.
- `NcrPanel`, `QcHoldPanel`, `MaterialApprovalPanels` were never on this page — nothing to remove
  there, they simply don't exist in this component tree today.

---

## Part 2 — Ideas / options for discussion (nothing decided)

### 2.1 QC and Dispatch — the "don't lose anything" path

Since stripping either to read-only today would genuinely remove capability, the real move (if the
goal is still "consolidate onto the main department tab") is **build the missing piece on the main
tab first, then retire the Project View copy** — not strip-then-backfill:

- **QC**: give `/qc` a real, project-scoped test-record surface (reusing `QcPanel` itself, or a
  thin wrapper around it, gated behind `/qc`'s existing project picker) covering add/edit/delete/
  pass-fail/rework/raise-NCR for all test types including hydro; and a Job-Work Inspection tab
  (`JobWorkPanel` reused as-is, project-scoped the same way). Once both exist and are verified
  equivalent, `QcProjectSummary` on Project View could absorb/replace the 4 inline `QcPanel`s +
  `JobWorkPanel` with the same read-only-summary-plus-Manage-link pattern it already uses for certs/
  documents — a genuinely consistent QC section instead of "some things are summaries, some are
  full editors."
- **Dispatch**: add the "Pending PDF" export and a per-project packing-list-history view (all
  statuses) somewhere reachable on `/dispatch` — e.g. a project filter on `DeliveriesTab`/
  `DocumentsTab`, or a dedicated drill-in from the Pending Items queue's per-project card. Once
  that exists, `PackingPanel` on Project View could shrink to a summary + link, matching the
  Procurement/Allocation-panel precedent.
- **Alternative, smaller move**: leave both exactly as they are (full, editable, inline) and accept
  the duplication as intentional — Project View stays the one place a head can act without
  leaving the project, and the main-tab workspace stays the cross-project triage surface. This is
  arguably already the working model for QC/Dispatch, just not yet applied consistently everywhere.

### 2.2 Accumulating documents — three possible shapes

- **Option A — a real merged timeline.** Extend the SQL-`UNION ALL`-with-`sort_rank` pattern
  (§1.6's ledger-function precedent — the strongest fit, since it scales in SQL rather than JS) into
  a new query pulling from the 10 currently-invisible tables above, producing one chronological
  feed on the Project View page, grouped by `department` (§1.6's grouping-key finding) rather than
  the customer-facing `CUSTOMER_PHASES`. Real "as it moves department to department, things
  accumulate" experience; the biggest build (new query + new UI section), and needs a decision on
  how to handle the three tables that resist clean project-scoping (`vendor_bills`,
  `journal_entries` indirect; `gate_passes`/`gate_inward_receipts` structurally project-less today).
- **Option B — per-record-type summary cards, no unified feed.** One small read-only card per
  currently-invisible category ("3 invoices, ₹X total", "2 open NCRs", "1 pending inward approval")
  each linking out to the real record — much closer to the existing Procurement/`QcProjectSummary`
  pattern, far less new query work, but doesn't deliver the "accumulates as it moves" feel on its
  own; reads more like a dashboard than a trail.
- **Option C — reuse the Customer Portal's query shape, department-grouped instead of phase-grouped.**
  Copy the *pattern* (independent, already-project-scoped `Promise.all`'d queries, one per table —
  §1.6 item 2) but build a real, data-driven grouping-by-`department` instead of the portal's
  hardcoded 3-entry phase map, and drop the customer-only filters (`status != 'draft'`,
  `customer_visible = 1`) since an internal, PM/head-facing view should show drafts and internal-
  only records too. A middle ground between A and B — reuses proven query shapes for the fetch side,
  but the grouping/rendering is new.

### 2.3 Open questions still to resolve before any implementation plan

1. Which of §2.1's paths for QC/Dispatch — build-then-strip, or accept the duplication as
   intentional? (A different answer per department is fine.)
2. Which of §2.2's three shapes for the document trail — or a mix (e.g. Option B now, Option A/C
   later once real usage shows what's actually missed)?
3. For the 3 tables that don't cleanly attribute to one project (`vendor_bills`, `journal_entries`,
   `gate_passes`/`gate_inward_receipts`) — include them via a schema change (add `project_id` or
   thread it through `po_id`), or explicitly exclude them from the trail and document that as a
   known limitation (matching this codebase's own stated preference for flagging a real limitation
   rather than forcing a fake number)?
4. Sales/Marketing/HR/Accounts currently have zero Project View presence — is that correct as-is
   (they're genuinely not project-scoped departments the way manufacturing depts are), or does the
   redesign want to surface anything for them too (e.g. a project's own Sales Invoice/Costing data,
   found in §1.6's table, might belong on this page even though Sales itself has no
   `DepartmentPanel` branch)?
