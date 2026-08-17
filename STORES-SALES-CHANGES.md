# Stores / Sales — Changes Log

**Status:** 🟡 Cheap fixes shipped 2026-08-17 (§3.1 + the two Sales gaps from §2b). **Not shipped:**
the Item Master catalog wiring (§3.2) — deliberately deferred, sequenceable, not started. Once §3.2
ships too, fold the full as-built behavior into `SYSTEM.md` §5c/§5e and mark this doc done, same
pattern `PROCUREMENT-CHANGES.md` and `QC-CHANGES.md` already follow.

**What shipped 2026-08-17** (decisions made, resolving §4's open questions for this round):
- Stores gets a non-binding "possible match" keyword-overlap hint on Open Requests
  (`components/StoresWorkspace.jsx`), and a notification whenever a new BOM lands (single-add,
  PMB import, or a PR line) — `app/api/bom-items/route.js`, `app/api/projects/[id]/bom/import/route.js`,
  `app/api/purchase-requisitions/route.js`.
- Sales → PM handoff: **not** a notify-PM fix — instead `POST /api/projects` now accepts
  `isDesignHead(user)` (PM tier OR a Design head), not PM-only. Sales gets a real "Convert to
  Project" button per Sale Order (`components/SalesWorkspace.jsx`'s `SaleOrdersTab`), gated
  server-side the same way, hidden client-side once a project already exists for that SO
  (`getSaleOrders()` now left-joins `projects.sale_order_id`).
- SAS: **not** left Stores-initiated — Sales now has a real "Request from Stores" push per Sale
  Order, reusing the exact same `source='sas'` PR-line mechanism Stores' own flow already used
  (`app/api/purchase-requisitions/route.js`'s `PR_DEPARTMENTS`/`SAS_RAISERS`). Stores-initiated SAS
  still works unchanged; this only adds a second raiser.
- Not touched: Item Master catalog (§3.2, still the real structural fix for BOM↔inventory
  matching), Stores'/Dispatch's daily-UI redesign (§2c, still waiting on its own meeting).

**What shipped 2026-08-17, second pass** (documentation + discoverability for the above):
- Help page (`components/department-help-content.jsx`): Sales' "Sale Orders" feature and "Hand off
  cleanly" how-to step now document Convert to Project and Request from Stores; a new "Request
  material for a SO" how-to step was added. Stores' intro/Reservations/"In-Stock and SAS material"
  entries now document the new BOM-landed notification and the possible-match badge.
- Operations tab (`app/page.js`) gets a Sales pipeline flow diagram (`components/SalesFlow.jsx`,
  `getSalesFlowCounts()` in `lib/data.js`) — Leads → Quotations → Sale Orders → Projects, same
  slot/pattern as Procurement's and Design's. Verified against real seed data (0 open leads/quotes,
  3 open Sale Orders, 2 already converted to Projects).

**Received, not yet acted on:** a real Item Master sample workbook (`Shanti Boiler_Sample Item
Master with Validation (Purchase).xlsx`, user's Downloads) for when §3.2 gets picked up.

**What shipped 2026-08-17, third pass:**
- SO creation now notifies PM tier + Design (`app/api/sale-orders/route.js` and
  `app/api/quotations/[id]/convert/route.js`'s SO-from-quotation path, both `dedupe_key:
  so_created:<id>`). Verified end-to-end: creating a test SO notified Design's two users (vijay,
  ravi) + all three PM-tier accounts (admin, manager, executive), then cleaned up.
- Converting a SO to a Project now *also* notifies PM tier + Sales (`app/api/projects/route.js`,
  `dedupe_key: so_converted:<id>`) — on top of the pre-existing Design+Engineering Scope-of-Supply
  notification, which still fires unchanged. Not yet browser-verified — needs a Design-head/PM
  login this session didn't have.
- New `notifyPMs()` in `lib/notify.js` — a deliberate, narrow exception to `notifyDepartment`'s
  by-design PM exclusion (PMs have no `departments` value specifically so per-milestone-handoff
  noise never reaches them). Used only for these two commercial events, not a general opt-in.
- Projects table (`app/projects/page.js`) now shows a department pill row under the health badge —
  "who currently has the ball" per project, from a new `activeDepartments` field on
  `getProjectsWithStatus()` (`lib/data.js`): departments of any `in_progress`/`blocked` milestone,
  falling back to the next not-yet-started milestone's department so every project shows at least
  one pill. Browser-verified against real data (SB-1018 → Installation, SB-1022 → Design).
- Help page's How To now supports real subsections instead of one flat step list — Sales' guide has
  a "Sale Order" section (5 steps) and a separate "SAS material request" section (1 step), each with
  its own intro card and its own Step 01 numbering (`components/DepartmentHelpWorkspace.jsx`'s
  `NumberedSteps`, gated on an optional per-step `section` field — every other department has none,
  so they render exactly as before). Browser-verified.

**What shipped 2026-08-17, fourth pass** (Help page "Notifications" feature for the departments
touched by this doc's work):
- New "Notifications" feature added to Sales and Stores (`components/department-help-content.jsx`)
  — each documents exactly what that department sends/receives and why, sourced from the real
  `notifyDepartment`/`notifyPMs` calls added in passes 1–3, not invented. Sales verified in-browser.
- Design's existing Notifications group (already had Customer/Departmental children) — extended, not
  rebuilt: the new SO-creation-notifies-Design event was added to its cross-department content, then
  that single "Departmental" child was split into two peers, "Internal (Design)" and "External
  (Departments)", reusing the exact same one-level group/children mechanism the Customer/Departmental
  split already used (`DepartmentHelpWorkspace.jsx`'s `flattenFeatures`/`SidebarMenuSub` — unchanged,
  no new nesting support needed). Internal = handoffs entirely within Design's own four consecutive
  milestones; External = anything crossing a department or commercial boundary (Sales, Procurement,
  PM tier). Not browser-verified this pass — no Design-access login available to the agent; syntax-
  checked only.
- PM has no dedicated Help page (PM is a role tier, not a `DEPARTMENT_HELP` entry, and
  `app/help/page.js` already gives a PM every department's guide anyway) — PM-relevant notification
  facts are folded into Sales' and Design's write-ups instead of inventing a fake department entry.

**What shipped 2026-08-17, fifth pass:**
- **Item Master data loaded.** The `items` table was genuinely empty (0 rows) despite the doc's
  earlier "2,773 rows" note — that number was always the *workbook's* row count, not a DB row count.
  `scripts/import-item-master.mjs` (new, one-off) reuses the existing, never-wired
  `parseItemMaster()` (`lib/master-import.mjs`) and the same full-replace semantics
  `/api/masters/[type]/import` already implements, just run from a script since no UI trigger exists
  yet. Ran against the user's real workbook (`Shanti Boiler_Sample Item Master with Validation
  (Purchase).xlsx`) — **2,773 rows inserted**, verified by direct query. This is data landing in the
  schema only — §3.2's actual wiring (BOM/inventory creation referencing `item_code` as a real join
  key) is still not built; that remains the genuine, larger project.
- **Stores daily-UI redesign, first real pass on §2c.** Added a "today" summary — four chips (open
  requests / with a possible match / low stock / ready to issue) computed client-side from the same
  three lists already on the page, no new query or schema. Each chip is an anchor jumping straight to
  its section (`#requests-card`/`#inventory-card`/`#reservations-card`). Browser-verified as
  `stores_head`: chips showed real counts (3 open requests, 0 elsewhere, matching an empty
  Inventory), and the anchor jump worked. This addresses the doc's exact original complaint ("no
  dashboard, no 'here's what needs your attention today'") without a bigger rebuild — Dispatch's own
  packing-board redesign (also flagged in §2c) was not touched, out of scope for this pass.

**What shipped 2026-08-17, sixth pass** (fixed the two real gaps surfaced by the user's own
questions about the flows above):
- **Stores notified on Received.** `app/api/bom-items/[id]/route.js`'s PATCH handler now fires
  `notifyDepartment('Stores', ...)` on the transition into `purchase_status='Received'` (same
  transition-guard idiom as the pre-existing Cancelled→release-reservations block right above it),
  with context: project number for a normal BOM line, `'into stock'` for source='stock', `'for SO
  #...'` for source='sas'. Verified end-to-end by replaying the exact transition against a real bom
  item (id 1305, MS PLATE / SB-1022) — the bell showed "Procured: MS PLATE — for SB-1022" live as
  `stores_head`, then reverted.
- **Procurement sees a "Reserved from stock" badge.** `getSourcingItems()` (`lib/data.js`) now
  returns `reserved_qty` (sum of active `inventory_reservations` per bom_item); `EnquiryRow` in
  `components/ProcurementWorkspace.jsx` shows a badge when it's non-zero. This doesn't change
  `purchase_status` (Reserve still doesn't, only Issue does) — it's visibility only, so Procurement
  doesn't duplicate sourcing work Stores already covered. Verified the underlying query directly
  (inserted a real reservation, confirmed `reserved_qty` computed correctly, cleaned up) — the JSX
  itself is a one-line conditional, not browser-clicked (no Procurement login available).
- Stores' Help page (Reservations + Notifications features) and Procurement's Help page (Enquiry
  queue feature) updated to document both fixes — browser-verified. Per user feedback, Stores'
  Notifications page does NOT document the SO-creation/conversion non-events (removed after initial
  draft — out of scope for what Stores needs to know).

**What shipped 2026-08-17, seventh pass:**
- **SAS is now Sales-only, not Stores-initiated at all.** `SAS_RAISERS` in
  `app/api/purchase-requisitions/route.js` is now `{'Sales'}` (was `{'Stores', 'Sales'}`). Stores'
  own Requests picker (`components/PrWorkspace.jsx`) no longer offers "Trade (SAS)" as a Kind —
  only Project material and Build stock remain, both still Stores' own. `saleOrders` prop-threading
  (PrWorkspace/`app/pr/page.js`) was dead-code-removed along with it. Browser-verified: the Kind
  dropdown shows exactly two options now, and the server rejects `source='sas'` from any dept but
  Sales. Stores' Help content (In-Stock and SAS material, Notifications) rewritten to match — no
  more "same way as one you raise yourself" framing, since Stores can't raise it anymore.
- **"Material issued to WIP" — a real UI for a permission Stores already had.** Stores could always
  POST `/api/material-issues` server-side (`canIssue = Stores OR Production`) but had no button —
  only Production's `WorkersPanel.jsx` used the endpoint. New `MaterialIssuesCard` in
  `components/StoresWorkspace.jsx` (project picker → BOM item → qty → Log issue, mirroring
  Production's own form) fixes that. Deliberately distinct from Reserve→Issue — this is a pure
  append-only log of material physically leaving Stores for WIP, doesn't touch `on_hand` or
  `purchase_status`. `app/stores/page.js` now also fetches `getActiveProjectsList()`. Browser-
  verified end-to-end: logged a real issue (MS ANGLE, qty 2) against SB-1018, confirmed it appeared
  in the recent-issues list, then cleaned up. Help page got a new dedicated "Material issued to WIP"
  feature (own `FEATURE_FOUNDATIONS` entry, not the generic fallback) and the "Issue material"
  How-To step was corrected to mention it instead of claiming no such screen exists.

**Raised, not yet built — needs a scoping decision (see chat):** an Auto/Manual toggle for stock
reservation — Auto would reserve automatically the moment a matching BOM/SAS line is released;
Manual would hold new lines out of Procurement's Enquiry queue entirely until Stores explicitly
picks Reserve or Procure, instead of today's "everything defaults straight to Enquiry regardless of
stock" (§2a/§3, still the core unfixed gap). This is a real state-machine change (a new pre-Enquiry
bom_items state, not just a notification or a badge) — assessed, not built, pending user confirmation
on scope. Recommendation: build Manual mode now (real fix for §2a), defer Auto mode until §3.2's
real item_code matching exists — auto-reserving off today's fuzzy keyword-overlap match risks
silently committing the wrong physical stock to a project.

**What shipped 2026-08-17, eighth pass — the big one: Manual mode built, Stores flow diagram, Stores
Incidents:**
- **Manual-mode reservation gate, actually built.** New `bom_items.pending_review` column
  (`lib/db.js`, plain boolean, deliberately NOT a new `purchase_status` enum value — that would have
  rippled into `derivePurchaseStage`/`BomStageBar`/`ProcurementFlow`'s 5-stage bar everywhere).
  Fresh bom/SAS lines (PMB import when no historical status exists, single BOM-item add, and the
  bom/sas branches of `purchase-requisitions`) now insert with `pending_review=1`; Stores' own Build
  stock requests skip it (`pending_review=0`, no self-review needed). `getSourcingItems()`
  (Procurement's Enquiry query) now excludes `pending_review=1` rows entirely — they're genuinely
  invisible to Procurement until Stores acts. New `POST /api/bom-items/[id]/procure` (Stores-gated)
  clears the flag with no purchase_status change. Stores' Open Requests got a "Stores Review" badge
  + Procure button (Reserve already worked unmodified — `reserveFromStock` never checked the flag).
  Verified end-to-end: inserted a pending SAS-source row, confirmed the "Stores Review"/Procure UI,
  clicked Procure live, confirmed `pending_review` flipped to 0 and the row became visible to
  Procurement's exact query, cleaned up.
- **Auto/Manual toggle, UI-only as instructed.** `ReservationModeToggle` in
  `StoresWorkspace.jsx` — Manual is default and is the only real behavior (regardless of which is
  selected); picking Auto shows a "coming soon" note per explicit instruction, no backend behavior
  changes. Browser-verified both states.
- **Stores flow diagram** (`components/StoresFlow.jsx`, `getStoresFlowCounts()` in `lib/data.js`) —
  same Operations slot as Procurement/Sales/Design. Two source boxes the user asked for (SAS/Trade
  from Sales, BOM Released from Design) plus a third for completeness (Build Stock, Stores' own),
  feeding a Requests → Stores Review → Reserved → In-Stock spine, with a "Received (via
  Procurement)" terminal linking to Procurement's own pipeline instead of duplicating its 5 stages.
  Browser-verified against real counts (3 open requests, all `bom`-sourced; 6 Received).
- **Stores Outgoing/Incoming Incidents** on Operations (`app/page.js`) — exact same direction-split
  `TicketsPanel` pattern Procurement already has. No new notification plumbing needed:
  `POST /api/production/tasks` (what the Raise dialog already calls) already fires
  `notifyDepartment` — verified live, raising a test incident from Stores to Procurement notified
  `procurement_head` in real time, then cleaned up.
- Stores' Help page updated: new "Manual review (Stores Review / Procure)" feature, intro mentions
  the flow diagram, Tasks feature mentions the Incidents cards. Browser-verified.

**What shipped 2026-08-17, ninth pass — the two gaps found in the eighth-pass audit, fixed:**
- **Procurement notified on Procure.** `app/api/bom-items/[id]/procure/route.js` now fires
  `notifyDepartment('Procurement', ...)` after clearing `pending_review` — closes the pre-existing
  gap where Procurement never heard about new demand through the live flow. Verified live: clicking
  Procure notified both `procurement_head` and `proc`, then cleaned up.
- **Released reservation re-flags a still-gated line.** `releaseReservation()` (`lib/procurement.js`)
  now checks whether the bom_item is still `pending_review=1` and not yet closed after releasing,
  and if so notifies Stores that the line needs a fresh Reserve/Procure decision — skips the
  cancel-cleanup path (`releaseReservationsForItem`, called from the Cancel route after
  `purchase_status` is already `'Cancelled'`), since a cancelled item isn't awaiting anything.
  Verified live end-to-end: reserved a test line, released it, confirmed `stores_head`/`stores`/
  `babji` were notified "Reservation released — needs a decision", then cleaned up.
- Help content updated on both sides: Stores' "Manual review" feature and Notifications feature,
  Procurement's "Enquiry queue" feature — all three browser-verified.

**Still explicitly deferred, not touched:** whether Sales needs its own Projects-tab view to check
progress; splitting "Design progress" into a per-current-department progress column plus a separate
overall-progress column (the department pill above answers "who", not "how far along that
department's own work is" — that's still open); §3.2's real item_code wiring into BOM/inventory
creation; Dispatch's own daily-UI redesign.

---

## 1. Why this doc exists

The session that produced this investigation had just shipped a customer-facing drawing-approval
feature for Design (see `SYSTEM.md` §5g's Design section and the Help page's new Notifications
content). While scoping what to do next, the user asked two blunt questions that turned out to have
real, traceable answers rather than assumptions:

1. Does Sales have good enough UI today to send an SAS request to Stores, and a Sale Order to Design?
2. When a BOM is created and some of its line items are already sitting in Stores' inventory, what
   *should* happen, and what actually happens today?

Both were investigated by reading the real code (not guessed), file-by-file. Findings below.

---

## 2. Background — what actually happens today (investigated 2026-08-17)

### 2a. BOM creation and stock routing — traced precisely

- **Every normal project BOM** (the everyday 10-line boiler BOM) is created via the PMB `.xlsx` import
  (`app/api/projects/[id]/bom/import/route.js`) or the single-line add
  (`app/api/bom-items/route.js` POST), both Engineering-gated. Neither sets `bom_items.source`
  explicitly — every row relies on the schema default, `source = 'bom'`. This is a **separate origin**
  from the unified PR flow (`/pr`, `purchase_requisitions`/`pr_items`), which is where
  `source='stock'|'sas'` rows come from instead.
- **There is no automated matching anywhere in the codebase** between a `bom_items` row and
  `inventory_items` — no join, no fuzzy text comparison, nothing dead or unused doing this. Confirmed
  by grep across every file that references `inventory_items`.
- **Every new BOM row lands in Procurement's Enquiry queue by default, regardless of stock.**
  `getSourcingItems()` (`lib/data.js`) has no `source` filter — its own comment notes `source='stock'`/
  `'sas'` rows flow through Procurement's real tabs "on purpose." So "3 of 10 already in stock" today
  means **all 10** still show up in Procurement's queue until a human intervenes.
- **The actual fulfil-from-stock path exists and is cleaner than expected, but fully manual.** Stores'
  workbench (`getOpenBomItems()`, `lib/data.js`) shows every open BOM row regardless of `source`. A
  Stores user picks a matching item from a **plain, unfiltered inventory dropdown**
  (`components/StoresWorkspace.jsx`, no search/filter by description) and hits Reserve
  (`POST /api/inventory-items/[id]/reserve` → `reserveFromStock()`, `lib/procurement.js`). This writes
  an `inventory_reservations` row against the **same** `bom_items.id` — no new `/pr` line needed, no
  `source` edit happens or is even possible (`bom_items.source` is never PATCH-editable on the
  existing route). Reserving the **full** quantity creates no duplicate row. A **partial** reservation
  intentionally splits the row in two (original row's `qty_text` reduced, a new cloned row carries the
  reserved portion through to Issue) — by design, documented in `lib/procurement.js`, not a bug.
- **Bottom line:** the mechanism to fulfil from stock without creating a mess already exists and
  works. What's missing is entirely on the *detection* side — nothing tells a human "this BOM line
  probably matches something you already have."

### 2b. Sales → Stores (SAS) and Sales → Design (SO) — traced precisely

- **SAS is Stores-initiated today, not Sales-pushed.** Per `SYSTEM.md` §5e and confirmed in
  `components/PrWorkspace.jsx`: a `source='sas'` line is raised from `/pr` by **Stores**, who picks an
  existing Sale Order from a plain search dropdown (`GET /api/sale-orders?search=`, no filtering or
  ranking — just every SO matching the typed text). There is no code path where Sales "sends" a
  trade/SAS request to Stores. If the mental model is Sales-initiated SAS, that flow does not exist
  yet — it would need to be designed, not just surfaced better.
- **Creating a Sale Order notifies no one.** `app/api/sale-orders/route.js` POST has zero
  `notifyDepartment`/`notifyUser` calls.
- **Sales has no UI to turn their own SO into a Project.** `POST /api/projects` is PM-tier gated
  (`requirePM`) — a Sales user cannot create a Project themselves, and `SalesWorkspace.jsx` has no
  "Create Project" or "Convert to Project" action anywhere. Today, a Sales person creates the SO, then
  has to tell a PM out-of-band (call, message) to go create the Project from it.
- **Once a PM does create the Project, the rest works correctly** — `POST /api/projects` notifies both
  Design and Engineering (`notifyDepartment`) when the Scope of Supply is created, and auto-seeds
  milestones. The gap is specifically the **Sales → PM handoff step**, not PM → Design.

### 2c. Stores' and Dispatch's daily UI, as it exists today

- Stores' entire workspace is three plain, disconnected tables: Requests, Reservations, Inventory. No
  dashboard, no "here's what needs your attention today," no cross-referencing between them beyond
  what a human does by eye.
- Dispatch's entire dedicated surface is the packing board (Pending → Ready → Dispatched) plus the
  generic cross-department incidents panel every department gets. Nothing else — confirmed, not an
  oversight in the investigation.

---

## 3. The two sizes of fix — recommendation, not yet decided

Raised in the investigating session, restated here for the new chat to actually decide on:

1. **Cheap, real, low-risk win:** a "possible match" hint on Stores' BOM/Requests view — simple
   keyword/substring matching between a BOM line's free-text description and inventory descriptions,
   shown as a non-binding nudge (never auto-reserves). Turns "eyeball every inventory row" into
   "eyeball the 3 the system already flagged." Pairs naturally with also notifying Stores when a new
   BOM is released at all (today: zero notification, confirmed in §2a) — small, high-value, no schema
   risk.
2. **The actual structural fix, larger scope:** `bom_items.material_description` and
   `inventory_items.description` are both free text today — that is *why* no automated matching
   exists, not an oversight. The **Item Master catalog** (`items` table — 2,773 real rows, parser and
   import route already built per `4.5-DATA-INVENTORY.md`, never wired into any live UI) was built for
   exactly this: a shared `item_code` both BOM lines and inventory rows could reference instead of
   independently retyped free text. Once wired in, real matching — and eventually real
   auto-reservation — becomes possible. This is a genuine project (touches how BOM items *and*
   inventory items both get created, not just Stores' one screen), not a quick add. The user's own
   framing: *"this can be completely automated and users can focus on physical things"* — true, but
   only reachable through this path, not the cheap hint above.

**Tentative direction from the investigating session** (the new chat should confirm, not assume): try
integrating SAS/SO flows into the **existing** Sales workspace/system first (§2b's gaps are UI/wiring
gaps, not architectural ones — the SO/quotation/customer tables already exist and work). Only reach
for a **new, dedicated SAS/SO module** if the current Sales system proves genuinely not adaptive
enough once someone tries to actually build the Sales→Stores push and the Sales→Project handoff inside
it. Don't default to a new module up front.

---

## 4. Open questions for the new chat

- Does the Item Master catalog integration (§3.2) happen now, or does the new chat start with the
  cheap hint (§3.1) and revisit the catalog later? These are sequenceable, not mutually exclusive.
- Should Sales get a real "Convert to Project" action (gated appropriately — still likely PM-approval,
  but at least *initiated* by Sales instead of requiring an out-of-band ask), or should the fix instead
  be a notification to PMs when a new SO is created, leaving Project creation as PM-initiated as it is
  today?
- Should SAS become genuinely Sales-initiated (a real "push to Stores" action), or is the current
  Stores-initiated model actually fine and this was a framing mismatch, not a real gap? Worth checking
  with whoever originally specified §5e's SAS design before assuming it needs to change.
- Per §3's "integrate into current Sales system vs. new SAS/SO module" call — what does "not adaptive
  enough" concretely mean here? Worth defining a threshold before starting, so the decision doesn't
  drift mid-build.
- Stores' and Dispatch's actual daily-UI redesign (§2c) is explicitly waiting on a separate meeting
  (mentioned in the investigating session, not detailed here) — check whether that meeting has
  happened and what it decided before designing new Stores screens.

---

## 5. Related docs

- `4.5-DATA-INVENTORY.md` — current DB state, including the `items` catalog's exact status (parsed,
  import-ready, 2,773 rows, never loaded).
- `SYSTEM.md` §5c (Procurement) and §5e (Sales/Stores/SAS) — as-built reference for everything this
  doc's investigation is built on top of.
- Auto-memory `notification-and-access-rollout-backlog.md` — a **separate**, unrelated deferred
  backlog (notification audit + two-level access + help docs + incident panels across ~9 departments).
  Do not merge that work into this doc; they were deferred independently.
