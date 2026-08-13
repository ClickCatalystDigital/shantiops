# Design Ops + Project Page Redesign — Decisions Log

Scope: Design department's Operations view and Project page, plus two small
Projects-tab/Requests-tab tweaks. Companion to `SYSTEM.md` (§3, §5f Round 2) and
`V3_CHANGES.md` (§18) — read those first for what exists today; this file only tracks
what's changing and why, kept short on purpose. Check boxes off as work lands. Don't
re-litigate the "why" here — that's in chat history if it's ever needed again.

## Files — lookup by area

Ask for a row below by name ("give me the Operations page files") and upload exactly that list to
a fresh chat — each row is self-contained, nothing assumed from earlier context.

| Area | Files needed | Status |
|---|---|---|
| **Operations page** (unified card) | `app/page.js`, `components/DesignFlow.jsx`, `components/DesignMasterTable.jsx`, `components/TicketsPanel.jsx`, `components/ProcurementFlow.jsx` (reference only, for pattern consistency) | All have |
| **Project page — Row 2 slot 3** (mini flow / downstream progress) | `app/projects/[id]/page.js`, `components/BomProgress.jsx` (being replaced), `components/DesignFlow.jsx`, `lib/data.js` (needs 2 new project-scoped functions — see Findings) | Have; new query functions still to write |
| **Project page — Design panel** (Calc/Drawings/Activity/SoS) | `components/DepartmentPanel.jsx`, `components/DesignPanel.jsx`, `components/ScopeOfSupplyPanel.jsx` | All have |
| **Project page — Milestones card restyle** | `components/PortfolioDelayTimeline.jsx` (visual language to match), `components/MilestoneBoard.jsx` (the actual card being restyled) | **`MilestoneBoard.jsx` still needed** — not yet uploaded |
| **Project page — Stages/Kanban** | `components/StagesPanel.jsx`, `components/DepartmentPanel.jsx` | Have — see Findings, this one needs a design decision before it's just a file edit |
| **Project page — Incidents rename/reposition** | `components/TicketsPanel.jsx`, `components/DepartmentPanel.jsx`, `components/TodayBand.jsx` (to reposition near) | All have |
| **SoS auto-create notification** | `app/api/projects/route.js`, `lib/notify.js` (**still needed** — not `lib/db.js`, see Findings) | Have route; still need `lib/notify.js` |
| **Projects tab** (SoS status column) | `app/projects/page.js`, `lib/data.js` (needs 1 new bulk-status function — see Findings) | Have; new query function still to write |
| **Requests tab** (category mini-form) | `components/PrWorkspace.jsx` | **Already built — see Findings, likely nothing to do here** |

**Confirmed not relevant to this pass, don't re-request:** Calc engine internals (`lib/calc.js`,
`lib/calc-engine.js`, `lib/calc-import.mjs`, `lib/calc-export.js`, `lib/calc-report-pdf.js`),
`app/api/projects/[id]/route.js` (rename), `app/api/notifications/route.js`, `app/calc/page.js`,
`app/calc/project/[id]/page.js`, `app/notifications/page.js`, `app/layout.js`,
`app/api/scope-of-supply/[id]/route.js` (PATCH-only, doesn't touch create/notify).
`app/help/page.js` — later pass, see its own item below.

**Low priority, only if that specific area needs it:** `lib/milestones.js`, `components/ProjectHeader.jsx`,
`components/Nav.jsx`, `lib/bom-fields.mjs` (checked — has no `category` shape, that lives entirely
in `PrWorkspace.jsx` itself, see Findings).

**Findings confirmed from code — don't re-derive these:**
- SoS auto-create notification does **not** exist — `POST /api/projects` inserts the draft row with
  no notify call. `notifyDepartment` is **not** in `lib/db.js`; `TicketsPanel.jsx`'s own header
  comment points at `lib/notify.js` as where the notify mechanism actually lives — get that file
  before building this.
- `getProcurementFlowCounts()` and `getDesignFlowCounts()` (`lib/data.js`) are both global, not
  project-scoped. Row 2 slot 3's "same component, two states" plan needs two small new
  project-scoped functions (a single-project version of `deriveDesignStage` and of the procurement
  bucket logic), not a literal reuse of either.
- **Requests tab's category mini-form is already built**, not a gap. `PrWorkspace.jsx` already has
  `CATEGORY_FIELD_DEFS` (plate/ms_section/angle/standard) and renders the per-category dimension
  fields once a category's picked — exactly what the checklist item asked for. It's conditioned on
  `line.source === 'bom'`, which is the only source Design/Engineering ever use, so it already
  covers them. Re-verify against the real form before assuming there's build work here — there may
  be none.
- `components/MilestoneBoard.jsx` (not `TodayBand.jsx`) is the actual component rendering the
  Design-scoped milestone list on the project page (`DepartmentPanel.jsx` → `<MilestoneBoard
  milestones={deptMs} .../>`) — this is the file the "restyle to match the tracker" item needs, and
  it hasn't been uploaded yet.
- `StagesPanel.jsx` already avoids a literal Settings toggle — it's gated by `canManage` (PM/head),
  not a per-feature switch. But it's currently always rendered as its own persistent Card once a
  head has permission (empty "No stages yet" included), not surfaced contextually from inside a
  milestone's own detail. Making it truly contextual (only appearing when invoked from a milestone)
  is a bigger structural change than a style edit — flag this as a design decision to make explicit
  before touching the component, not a quick pass.

## Cross-cutting

- [ ] Summary chips (overdue / blocked / due-soon) become **multi-select filter
      pills** — clicking one or more filters everything below (master table + any
      list) to matching items. Needs a polished selected / multi-selected visual
      state, not just a color swap.
- [ ] This pill pattern is **shared, not Design-only** — build as one reusable
      component so every department's Operations view gets it.
- [ ] "Tickets" → **"Incidents"** everywhere it still says Tickets (project-page
      card specifically; Operations already says Incidents).
- [ ] Before repositioning Incidents on the project page: confirm whether raising
      one already fires a bell notification (likely yes, via `lib/notify.js` — the
      general task-raise path). If yes, no new wiring, just placement.

## Operations page (Design; pattern reused per department)

Replaces today's stack — [flow chart] → [master table] → [per-project needs-attention
cards] → [outgoing/incoming incidents] — with **one unified card**. Landed as three
stacked rows, not two columns as originally planned — see notes below.

- [x] **Row 1, full width:** Design flow chart (Concept → Calculation → Review →
      Approved → Released), centered. Shows plain per-stage totals, same as
      before — a per-stage "how many are overdue/blocked" badge was tried and
      removed (read as clutter, and "filter the flow chart by the pills" doesn't
      really make sense — the chart's job is to show everything, not a filtered
      subset). Whether/how to surface urgency on this chart is an open question,
      not designed yet — see "Open questions" below.
- [x] **Row 2, two columns:** Outgoing Incidents (left) / Incoming Incidents
      (right), each with its own header + circular count badge, divided by a
      vertical rule. (Originally planned as flow-chart-left/incidents-right in one
      row — moved to its own row once the flow chart needed full width to not look
      cramped/off-center.)
- [x] **Row 3, full width:** Design master table (Project | Customer | Design
      Progress | Bottleneck | Calc Status | Drawings), columns unchanged. Paginated
      at 15 rows/page (bare mode only — the standalone Card-wrapped version used
      elsewhere is unpaginated, unchanged).
      Optional nice-to-have: swap "3/9" text for a stacked mini-bar (matches Master
      BOM's existing bar treatment) — still not blocking, not done.
- [x] **Per-project "needs attention" cards: deleted**, for Design's Operations
      view specifically (`isDesignOnlyView` gate in `app/page.js` hides the whole
      generic Open Actions grid + pills for a Design-only view). Master table's
      Bottleneck column + the project page's own Open Actions card cover this.
- [x] **Filter pills**, sitting outside/above the unified card (top-right, not
      inside it) rather than inline with a chip row — narrows Incidents +
      Projects table to projects that have an overdue/blocked/due-soon item.
      Deliberately does **not** touch the flow chart — the chart always shows every
      project's stage, unfiltered. Every count that IS filterable (pills, table
      pool) now derives from the same project set: any project with calc/drawing
      data **or** any Design milestone at all (was calc/drawing data only —
      undercounted projects with milestones but no calc sheet started yet).
- [ ] Outgoing/Incoming pagination: done, 5/page. Table pagination: done, 15/page
      (see Row 3 above — folding this checkbox into that one, leaving here for
      traceability since it was asked for as a separate item).

## Project page

- [ ] Row 2, third card (currently the Master BOM slot): a **project-scoped mirror
      of the Design flow chip** — same 5-stage component, filtered to this project,
      current stage highlighted. Once handed off downstream, same card slot swaps to
      show **Procurement progress for this project** (reuse
      `getProcurementFlowCounts`, filtered by `project_id`) — same component, two
      states, no new visualization needed.
- [ ] Calc Sheets card + Drawings card sit **side by side** (both are compact
      checklists) instead of full-width stacked.
- [ ] Activity feed **collapsed by default** — "Recent activity (5)" with an
      expand-for-full-history control, not always-rendered.
- [ ] Scope of Supply: **editing surface stays here** (shared Design/Engineering
      row, unchanged) — no second editing surface anywhere else.
- [ ] Add the **missing auto-create notification**: when a Sale Order links to a
      Project and the draft `scope_of_supply` row seeds, notify Design (+
      Engineering). Confirmed missing (see Findings) — this is a real build, needs
      `lib/notify.js`, not a check-first item anymore.
- [ ] Milestones card (`components/MilestoneBoard.jsx`, Design-only milestone
      list): **restyle to the same connected-bar visual language as the top
      Milestone Tracker** (`PortfolioDelayTimeline.jsx`), department-filtered,
      instead of today's separate card-grid style — same data, consistent grammar,
      doesn't read as a duplicate.
- [ ] Stages / Kanban: **no Settings on/off toggle** — already true, it's
      permission-gated not feature-gated. Real gap: it's still an always-rendered
      persistent Card (even empty), not contextual from inside a milestone. Decide
      the actual contextual trigger (e.g. an "add checklist" action inside the
      milestone drawer) before treating this as a simple restyle — it's a
      structural change to `StagesPanel.jsx`'s mount point, not just its look.
- [ ] Incidents card: rename from Tickets (see cross-cutting), reposition near Open
      Actions in Row 2 instead of last on the page.

## Projects tab

- [ ] Add a read-only **Scope of Supply status column** (Draft / Released) to
      `/projects` — same treatment as the existing Design Progress column. No new
      browsable SoS list; status only, editing stays on the project page.

## Requests tab

- [x] Near-term step toward auto-BOM: category-based structured mini-form.
      **Already built** — `PrWorkspace.jsx` has `CATEGORY_FIELD_DEFS`
      (plate/ms_section/angle/standard) and renders it once a category's picked,
      for `source === 'bom'` lines (the only source Design/Engineering use). Confirm
      live it matches what design_head expects; if so, this item is closed, no
      code needed.

## Open questions for design_head (ask live, don't design around blind)

- [ ] Would he actually use a Stages/Kanban breakdown for Design specifically, or
      is the milestone chain granular enough already?
- [ ] Is the Activity feed something he checks day to day, or purely an audit
      trail? (Informs how aggressively to collapse it.)
- [ ] Should the flow chart surface urgency at all (e.g. "this stage has overdue
      projects in it"), and if so, what should that look like? A per-stage red
      count badge was tried and pulled back — read as confusing/cluttered, not
      obviously worth the visual noise. Deferred, not decided either way.

## Explicitly deferred / not decided

- Milestone renaming — waiting on executive discussion, out of scope for this pass.
- **Help page — Design section.** `app/help/page.js` needs a Design entry matching the
  Sales/Marketing format (`CrmHelpWorkspace.jsx`'s sidebar-workspace shell, vs. the plain
  `GuideSection` grid card every other department gets via `HEAD_GUIDES`). Explicitly a later
  pass, not this one — noted here so it isn't lost. Files for that pass, when it starts:
  `app/help/page.js`, `components/help-content.js` (`HEAD_GUIDES`), `components/CrmHelpWorkspace.jsx`.
