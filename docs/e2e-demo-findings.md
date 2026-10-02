# E2E demo run — findings & to-fix list

Run date 2026-10-03, admin login, dev server port 3001 (shared Turso DB).
Demo data: enquiry/customer **ZZ DEMO Vindhya Dairy Pvt Ltd**, QTN-33/SB/2026-27, SO-28, project **SB-1060 (id 312)**,
DG-1025 (drawing id 59), RFQ-10, POs 652/653/654 (ids 105/107/108), customer portal login `zz` / `DemoPass2026`.
Remove after the video with the project-delete flow + delete the customer/quotation/SO/demo inventory (98-103, 107-108 + 3 remnant items).

Status key: [ ] open, [x] fixed in this pass.

## Bugs / gaps found

- [x] **Portal "Approved Invalid Date"** right after the customer approves a drawing (optimistic update used an ISO `Z` string that `formatDate` can't read). Fixed in `components/PortalOrderProgress.jsx` (uses `todayISO()`).
- [x] **Customer approval impossible once Head approved first.** Fixed: portal button + `/api/calc-drawings/[id]/approve` now accept under_review/approved/as_built (still needs submit first). Portal only shows "Approve drawing" while status = Under review. Order for the video must be: Designer submits -> customer approves -> Head approves. Decide whether customer should still be able to approve an already internally-approved drawing.
- [x] **Admin cannot "Submit for review"** Fixed: Head/PM now get a Submit for review button (needs a file). on a drawing (button is only for the assigned designer). Single-login demo needs a designer login, or let Head/PM submit too.
- [x] **Milestone tracker order is wrong.** Fixed: template reordered + existing projects migrated by `scripts/reorder-design-milestones.mjs` (373 updates, backup in scripts/data). Currently Design, Dsn Appr, BOM/PR, Drawings. Should read Design -> Drawings (submitted/internal approval) -> Dsn Appr (customer approves) -> BOM/PR (released).
- [x] **Send-offer email dialog taller than the viewport with no inner scroll** (buttons unreachable at ~1000px height). Fixed: `max-h-[90vh] overflow-y-auto` + wider (SalesWorkspace.jsx).
- [x] **RFQ send/receive overlays** Redesigned (wider two-pane dialog, collapsible message preview; supplier form field grid + sticky submit). Not yet clicked through for the Create-RFQ dialog. need a premium, minimal, wider layout (user request).
- [ ] **Admin top nav is ~2,000px wide** (21 tabs); overflows any screen narrower than that.
- [x] **Customer State not copied from enquiry on convert** (enquiry State is stored as `leads.territory`; convert ignored it) -> GST split risk. Fixed in `lib/crm.js` (copies to `customers.state`). `state_code` still not derived (only from GSTIN) - open.
- [ ] **"Similar customer" banner shifts the New Enquiry form layout** while typing (clicks land on wrong fields).
- [ ] **Expected value typed on an enquiry overrides product lines total** (shows 15L while products total 25.3L). Confirm intended.
- [ ] **BOM tiles stale after "Build from Templates"** (0 items shown until reload).
- [ ] **Template BOM lines have no catalog link, no dimensions, ambiguous quantities** ("2 Nos 1 No 1 No 1 No") and bought-outs (valves, gauges) carry `requires_manufacturing=1`, so they default to Production. TASK FOR ENGINEERING HEAD: delete template id 9 "BOILER-SF-WB-350-10.54" (and review 7, 8) and rebuild templates from catalog-linked items with dimensions and correct manufacturing flags.
- [ ] **Procurement milestones never move on a 168-line BOM** (needs every line to clear a stage), so Projects "Overall" stays 4/25 through procurement. Portal shows Material "In progress" only.
- [ ] **Supplier's open draft PO is shared across projects** (my RFQ lines landed on draft PO 652 that already held another test project's lines); issuing it issued the other project's lines too.
- [ ] **Date shown one day early** on lists (SO-28 created "10/2/2026" while today is 10/3 IST).
- [ ] Portal "My Orders" card did not open on click in the test (direct URL worked) - verify.

## Status snapshots (Projects page row / tracker / portal)
| Stage | Projects "Overall" | Dept progress | Portal |
|---|---|---|---|
| After project created + drawing approved | 2 / 25 | Design | Design in progress, 11% |
| Service visit 1 done | 2 / 25 | - | Site visits 1 of 4 |
| Design sign-off | 3 / 25 | Design Not started->done | Design in progress |
| BOM released | 4 / 25 | Procurement 0/168 | Design Completed |
| RFQ/quotes/selection/POs issued | 4 / 25 | Procurement 0/168 | Material In progress |

- [ ] **Remnant demo needs dimensions on BOM lines**: template lines have none, so no auto-match; I added dims by API. Fix via catalog-linked templates.
- [ ] **Reserved bought-outs stay "Enquiry" until Stores clicks Issue**; then packing needs them marked ready. Easy to miss in the video: Reserve -> Issue.
- [ ] **"Generate packing list" creates a second list instead of extending the existing draft** (PL-1063 deleted by me, items added to PL-1062). Add a "add ready items to this list" action.
- [ ] **Packing "Completed" on portal while 154 template lines are still un-procured** (milestone ignores un-procured lines). Demo BOM should be small.
- [ ] Prod. Done had to be ticked by API for production-routed lines; confirm Production UI shows it clearly.
- [ ] Only one pending item (9099 Water Level Gauge) left un-procured for the Pending-list demo; verify it shows in Dispatch > Pending Items.
- [ ] Not exercised in UI (done via API): Stores receive/reserve/allocate, remnant cuts, job card stages, QC sign-off, packing approvals, dispatch, visit 2. Click-through still needed for the video.

## Run result (all via same routes the UI uses)
Enquiry -> quotation -> SO-28 -> project SB-1060 -> drawing approved (internal+customer) -> Design sign-off -> BOM from template -> release -> RFQ-10 (2 suppliers) + manual quotes -> selection -> POs 652/653/654 issued + delivery lots -> QC inward approved -> 6 remnants + 2 stock items reserved -> routed -> cut + remnants returned -> 33-stage job card + QC signs -> packing PL-1062 -> approvals -> dispatched -> service visit 2 done.
Snapshots: Overall 2/25 -> 3 -> 4 -> 16 (production) -> 17 (hydro+QC) -> 18 (packed). Portal moved Design->Material->Manufacturing->Quality->Finishing->Packing.

## Still to run
Stores receive/allocate (receipts done via API for 6 lines), production job cards + remnant cuts, remnant return to Stores, packing list, pending list, approvals, dispatch, service visit 2.

## Status column / Currently With (investigated 2026-10-03)
- The row quoted ("5 of 6 items still in procurement", tracker with only Release BOM -> Marking) is the seed project **ZZ-PLAN-TEST** (scripts/seed-plan-demo.mjs inserts two hand-made milestones). SB-1060 has all 25. No tracker bug.
- Fixed: list (`getBatchDepartmentStates`) now uses the same inputs as the detail card (`getDepartmentState`): Production falls back to work orders/job cards, QC counts pending inward + held cards, and **Service** shows "N of M visits done" from the first done visit until the last (`serviceVisitsEntry`). Verified on SB-1060: list and detail match.
- Open: Dispatch still only appears once a packing list exists (no "items ready to pack" pill yet); Sales/Accounts intentionally not shown; fix seed-plan-demo.mjs to call createProjectMilestones; stale `activeDepartmentStatus()` mentions in SYSTEM.md / PROJECT-VIEW-REDESIGN.md / GAPS-AND-NEXT-STEPS.md.
