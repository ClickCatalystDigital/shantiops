# Procurement Redesign — Changes Log

**Status:** In progress — building phase by phase (see "Rollout / build order" at the bottom).
**Purpose:** Single source of truth for the Procurement redesign while it's being built. Once each
phase ships, fold the final, as-built behavior into `SYSTEM.md` and mark that section done here.

This file went through two rounds before any code was written: an initial spec, then a
gap-check/plan-mode pass that resolved every open question below. Nothing is marked "open" unless
it's still genuinely undecided.

---

## 1. Background — how the current system actually worked (before this redesign)

Investigation findings, kept here so whoever picks this up understands *why* the old UI looked broken:

- **"Uncategorized" on the Operations "Waiting on — Procurement" card**: `delay_category` (in
  `lib/data.js`, `getWaitingList`) is only ever set when a head closes a milestone *late* and picks a
  reason in the drawer. None of Procurement's attention-worthy milestones had ever been closed late
  with a reason, so all 8 fell into the literal fallback string `'Uncategorized'`. Not a bug — the
  categorization feature had simply never been used on this data, which is also why the card was
  redundant with "Needs Attention" above it (same 8 items, just unsorted). **Resolution: this card is
  removed entirely** (§3).
- **"To source" ≈ "Delivered", and nothing in between**: zero suppliers and zero quotes existed
  anywhere in the database. Of the Sourcing tab's 5 lifecycle segments (no quote → quoted → comparing
  → supplier selected → on order → delivered/cancelled), only two were reachable without ever using
  the quote/PO feature: `delivered` (items whose `purchase_status` was already `CLOSED`/`RECEIVED` in
  the original imported spreadsheet) and `to_source` (everything else, by default). `comparing` and
  `on_order` — the actual point of the tab — were empty because no quote had ever been logged.
- **Every imported item showed in Procurement immediately** — no concept of Engineering/Design
  "handing work over." **Resolution: the new Requests tab + acceptance gate** (§4.0).
- **The mechanism, end to end (unchanged by this redesign, just re-surfaced)**: `to_source` (no quote
  logged) → `comparing` (≥1 quote logged, no winner picked) → `on_order` (a quote picked via
  "Select", sets `bom_items.selected_quote_id`) → `delivered` / `cancelled` only when
  `purchase_status` is manually flipped. Proved live with example data before this redesign started:
  two suppliers, three quotes on two MS ANGLE line items (project SB-1103), one quote selected, one
  real PO issued (579/SB/2026-27). That example data is being replaced by the Phase 0 reseed (§7).

---

## 2. Operations View (`/`) — Department Head Home

- KPIs go on top; the per-project breakdown (Master BOM list + per-project attention cards) is the
  least important thing here — demoted below the KPIs / folded into a secondary section.
- Pills for **overdue / blocked / due soon** — kept for now (open question, revisit later — see §5).
- **Decided:** replace the plain Sourcing/PO-placed/In-transit KPI tiles with a **left-to-right flow
  diagram**: `Requests → Sourcing → Selection → PO issued → Closed`, each stage showing its item
  count, hoverable/tappable with a plain-English explanation of what it means. A Sankey chart was
  considered and rejected — the pipeline is effectively linear (one branch point, not many crossing
  categories), and with sparse data a Sankey would look broken rather than informative, the way the
  old Sourcing tab numbers did (§1). Revisit Sankey only if a *breakdown* view (flow by project or by
  supplier) is wanted later.
- **Cancelled** shown as its own tile next to the flow diagram, since an item can be cancelled from
  any stage, not just the end.
- **"Waiting on — Procurement" card: removed.** Fully redundant with "Needs Attention" (§1).
- **"Needs Attention" renamed to "Open Actions"** — decided. Two groupings inside one card:
  1. **Urgent** (top) — items not yet delayed, ranked by proximity to the milestone's `planned_end`
     date (closest deadline first).
  2. **Needs Attention** (below) — items already delayed.
- **Tickets card: moved out of Operations entirely**, now lives inside the Requests tab (§4.0b).

---

## 3. Project Page — Procurement's Section

Target layout, top to bottom:

1. **Row 1 — Milestone Tracker**, moved to the very top, above the project header/attention area.
2. **Row 2 — three cards**:
   - Project detail
   - "Open Actions" (same renamed card / two-grouping structure as §2), scoped to this project
   - Master BOM, scoped to this project
   - *Resolved* — the earlier open question ("each item requested from engineering or design will
     require labelling to a project for this view") is answered by the new **Requests** tab (§4.0):
     items arrive from Engineering/Design through Requests, get accepted per-project there, and
     that's where the project labelling actually happens.
3. **Row 3 — Procurement queue**, already project-scoped, no change needed.
4. **Departmental milestone board — decided: keep it.** Milestones already carry a native
   `department` column, which is exactly what `DepartmentPanel` → `MilestoneBoard`/`MilestoneCard`
   already filters on for every other department — no new mapping needed. It's the only *actionable*
   surface on this page: the `MilestoneDrawer` Start/Close actions (with delay category + reason on a
   late close) live only here. The Milestone Tracker (Row 1) is read-only, Open Actions is a triage
   list, Master BOM is materials — none of them let a head actually start/close a milestone.
5. **Stages** — left as-is.
6. **Removed entirely from this page (for Procurement)**: the full BOM table and the Tickets/Raise
   card. All BOM work moves fully to `/procurement`. (Engineering/Design keep their own Tickets/Raise
   card on their own project-page sections — this removal is Procurement-scoped only, since raising a
   request is now how a request reaches Procurement in the first place.)

---

## 4. Procurement Tab — Full Redesign

### 4.0 New tab: Requests

Receives new-item and cancel requests from Engineering and Design. **Top-level nav tab** (sibling to
Operations/Project page/Procurement), gated the same way as the Procurement tab.

- A request is **not** a BOM item until Procurement accepts it. Accepting a new-item request
  **materializes** it — inserts the `bom_items` row with `purchase_status = 'PENDING'`, which is what
  makes it appear anywhere in Procurement. Rejecting leaves nothing behind for Procurement to see.
  Before acceptance, nothing shows up in Procurement at all.
- A cancel request works as it already did (existing `tasks.bom_item_id` + `accept-cancellations`
  flow) — surfaced in this same inbox instead of only on the project-page queue.
- **A request is one item, for now** — built by reusing the single-item Raise dialog (see below).
  True multi-item "lot" requests are a later enhancement, pending a process conversation with
  Engineering/Design.
- Accepting/rejecting does **not** notify the raiser yet — consistent with the existing
  "notify-the-raiser-on-resolution" gap already listed as deferred in `SYSTEM.md` §8.

### 4.0b Tickets — moved here from Operations

- Split into two modules: **Raised by Procurement** vs **Raised for Procurement**, instead of one
  mixed feed. Lives as a second module within the Requests tab, alongside the request-acceptance
  inbox. "Raised by Procurement" keeps a Raise action so Procurement can still raise tasks for other
  departments.
- The Raise dialog gains a **"Request procurement"** kind for Engineering/Design to use (alongside
  the existing "Cancel BOM item" kind) — this is the actual creation path for a new-item request.

### 4.1 Sub-tab 1: Sourcing

Accepted request items land here — this is where Procurement contacts suppliers. Intentionally kept
"dumb" for now (no auto-suggestion of who to contact / which supplier for which item); that
intelligence comes later (§6).

**Membership: accepted items with no supplier picked yet** (gathering quotes) — not mutually
exclusive with Selection; an item with quotes logged but no winner picked shows in both.

Items table, columns left to right:

| Column | Notes |
|---|---|
| Part Description | |
| Material Specification | |
| Size (in mm) | maps onto the existing free-text `size_spec` — no new structured numeric field this pass |
| Quantity (No.) | |
| PR Number & Date | if sent by Design team |
| Vendor Names / Make | multi-add suppliers for later selection |
| Quotes by each | per supplier |
| Payment terms by each | dropdown: LC (Letter of Credit), Advance % (reveals a searchable 10%–100% step-10 dropdown), After Delivery, PDC (Post Dated Cheque), COD (Cash on Delivery), plus an "add new option" ability |
| Expected Delivery | calendar-picker input — new `supplier_quotes.expected_delivery_date` column (existing `expected_delivery_days` kept for back-compat) |

Later phase (not now): surface WhatsApp/email contact buttons per vendor once the system knows whom
to reach out to for what (§6).

### 4.2 Sub-tab 2: Selection

**Membership: items with ≥1 quote, ready to compare/pick.**

- Select a single item or a batch of items and compare quotes.
- Shown per item/batch: payment terms, a "lowest price" label, a "fastest delivery" label.
- User picks exactly one supplier per item (batch-select just acts on several at once — a PO already
  requires all its lines to share one supplier, so "compare a batch" means "compare and pick per
  item, then act on the selected set together").
- **Decided — PO auto-drafting:** selecting a supplier for an item auto-creates or updates a **draft**
  PO grouping that supplier's currently-selected, not-yet-PO'd items, using the existing default
  terms (`delivery_schedule='IMMEDIATELY'`, `transportation='Our Scope'`, `freight='To Pay Basis'`,
  `guarantee='NA'`, `gst_pct=18`). Selecting more items for the same supplier appends to that same
  draft rather than creating a second one. The Purchase Orders tab (§4.3) is where terms get edited
  before Issue, not where a PO gets created from scratch — the old explicit "Create PO from a
  multi-select" flow is replaced by this, not kept alongside it.
- **Undo** brings the supplier options back for re-selection, and pulls the item out of its draft PO
  (deleting the draft if it becomes empty).
- Design goal: easy to use, premium, minimal.

### 4.3 Sub-tab 3: Purchase Orders

**Membership: draft, issued, and cancelled POs** — the drafts are what Selection (§4.2) auto-creates;
this tab is where their terms (delivery address, discount, GST, special instructions) get edited
before issuing.

- PDF actions: **View**, and **Issue**.
- Pressing **Issue**:
  - Downloads the PO file.
  - The "Issue" button disappears, replaced by a **"Cancel Issue"** button.
  - Item status moves from **PENDING** → **TRANSIT**.
- Pressing **Cancel Issue** — **decided:** un-issues the PO back to **draft** (re-issuable later),
  items revert **TRANSIT → PENDING**. This is distinct from the existing permanent PO cancel (which
  stays available separately and returns items to "on order," not back to draft).

### 4.4 Sub-tab 4: State

**Membership: every accepted item, always** — the one tab that isn't lifecycle-scoped, so status can
always be found and corrected regardless of where an item sits elsewhere.

Search box on top (same item universe as elsewhere). Table columns:

| Column | Notes |
|---|---|
| Part Description | |
| Material Specification | |
| Size (in mm) | |
| Quantity (No.) | |
| PR Number & Date | if sent by Design team |
| PO number | new |
| Make | selected supplier, new |
| STATUS | user-editable, overrides the automatic flow below |

Status values and colors — **decided: 5 statuses, RECEIVED kept**:

| Status | Color |
|---|---|
| PENDING | Gray |
| TRANSIT | Orange |
| CLOSED | Green |
| CANCELLED | Red |
| RECEIVED | Green (Stores' receipt signal — kept, not emphasized in Procurement's own dropdown) |

Statuses update automatically as items move through Requests → Sourcing → Selection → PO, but can
always be manually overridden here.

---

## 5. Open Questions / Decisions Still Needed

- Whether the overdue/blocked/due-soon pills on Operations are still wanted — **keeping them for
  now**; question stays open, revisit later.

Everything else that was open in round 1 has been resolved (see inline "decided" notes above).

---

## 6. Future Enhancements (post-launch, not part of this pass)

- **Supplier contact intelligence**: auto-suggest whom to reach out to per item, plus WhatsApp/email
  buttons directly on the Sourcing sub-tab (§4.1). Blocked on having a real supplier list —
  realistically answerable once the client provides one.
- **True multi-item "lot" requests** in the Requests tab (§4.0), once Engineering/Design's real
  process is understood — today a request is one item.

---

## 7. Data note — demo dataset

Before this redesign, the database held 780 rows of imported hand-made PMB Excel data with zero
suppliers/quotes ever logged — unreadable as a demo and unable to show the `comparing`/`on_order`
segments at all. **Decided:** wipe the bulky imported BOMs and reseed a small, easy-to-read demo
dataset spanning every stage (including a few pending Requests), so the whole flow is
self-explanatory for a demo. Real data comes later, once the system is complete. Users/logins and the
demo projects + their milestones/stages are untouched — only the BOM bulk and the procurement chain
(suppliers, quotes, POs, requests) get reseeded. See `scripts/seed-procurement-demo.mjs`.

---

## 8. Rollout / build order

1. ✅ This doc.
2. ✅ Reseed demo dataset (§7) — `scripts/seed-procurement-demo.mjs`, verified live.
3. ✅ Requests tab + acceptance gate + split Tickets (§4.0, §4.0b, §2 Tickets-card removal) —
   `procurement_requests` table, `/requests` page, `RequestsWorkspace.jsx`, "Request procurement"
   kind on the Raise dialog. Verified live end to end (raise → accept → materializes → shows in
   `/procurement`; split tickets; non-Procurement heads blocked). One simplification from the
   original draft: `procurement_requests` only ever stores *new-item* requests — no `kind`/
   `bom_item_id` columns — since cancel requests were already committed to keeping their existing
   `tasks`-based flow untouched; the Requests inbox just displays both from their two real sources.
4. ⏳ Procurement workspace's four sub-tabs (§4.1–§4.4) — next.
5. ⏳ Operations + project page restructure (§2, §3).

Each phase: build → verify live as a real department head → keep `node --test lib/handoff.test.mjs`
and `node lib/pmb-selfcheck.mjs` green → commit. `SYSTEM.md` gets updated once, after Phase 5, rather
than after each phase — its own convention is a coherent as-built snapshot per round, and updating it
mid-flight (while e.g. the project-page BOM table Phase 3 is meant to remove is still there) would
read as an inconsistent, half-migrated system rather than a clean round summary. This doc stays the
single source of truth for what's actually shipped in the meantime.
