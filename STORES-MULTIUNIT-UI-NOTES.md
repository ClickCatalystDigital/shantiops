# Stores multi-unit UI — what exists today, why it's confusing, what's next

Written 2026-09-05 after live-walking the real SB-1109-01-50 order (50 real units) through the
whole receive → allocate → route flow. Captures what's actually there right now (confirmed live,
not guessed) so a future redesign pass doesn't have to re-derive it, plus one new feature ask that
was raised but deliberately not built yet.

## What exists today (confirmed live)

All of this lives on the **master project's own page** (`/projects/{masterId}`), stacked with
everything else that page already shows (milestone tracker, department panels, the *entire* raw
181-row BOM table) — there is no dedicated multi-unit view anywhere in Stores' own workspace
(`/inventory`, `StoresWorkspace.jsx`'s sidebar). Three separate pieces, in page order:

1. **`AllocationPanel` — "Material allocation to unit projects"** (`components/AllocationPanel.jsx`).
   One row per BOM line: Description / Received / Allocated / Available / Allocate. Numbers are raw
   quantities (e.g. "Received: 40"), never framed as "N of 50 units" — you have to already know the
   per-unit quantity to mentally divide it out. A single-line "allocate to one unit" control plus a
   checkbox-bundle control ("Allocate 1 unit's worth to N checked units") sit below the table, but
   both operate **one BOM line at a time** — there is no "apply this same set of units to every
   line" action anywhere.
2. **`ChildRoutingPanel` — "Route material to Production or Dispatch, per unit"**
   (`components/ChildRoutingPanel.jsx`, Stores-gated). Defaults to showing only lines with something
   still awaiting a decision — once everything's routed, it reads "Nothing awaiting a routing
   decision," and you have to click **"Show all"** to see what was actually decided. Also one line
   at a time; routing 181 lines to the same split (e.g. "these same 10 units → Production") means
   181 separate decisions unless done by script.
3. **`ChildUnitBomCard` — "This unit's material list"** (`components/ChildUnitBomCard.jsx`), on each
   **child's own page** (`/projects/{childId}`). Per-line allocated/ready/routed status for just
   that one unit — the one place that actually reads as "this specific unit's own BOM," but you have
   to know the child's project id/URL to get there; nothing links to it from the master.

**No screen anywhere shows a single headline number like "20 of 50 units received."** The Customer
Portal computes that (`getCustomerViewSplitOrder()`, §5bi/§5bg in SYSTEM.md) but nothing internal
does — Stores has to read raw quantities and do the division themselves.

## Why it's confusing (the actual complaint)

- Everything lives buried on one giant project page (that page also renders the full 181-row raw
  BOM table, milestone tracker, every department's panel) instead of somewhere purpose-built.
- No unit-count framing anywhere internal — just raw quantities.
- Every action (allocate, route) is one BOM line at a time — doing a real 181-line multi-unit order
  by hand in the UI isn't realistic (this is exactly why the September 2026 lot-receiving pass for
  SB-1109-01-50 had to be driven by a script instead of the UI).
- A child unit's own material list has no way to reach it from the master page (need to already
  know the child's URL).

## What's needed — a real redesign, later

Move this into **Stores' own Inventory sidebar** (`StoresWorkspace.jsx`) as a dedicated tab/view,
not a stack of cards wedged into the master project page. Needs actual UX effort, not a quick patch
— worth its own design pass rather than deciding the shape here. Rough shape to start from:

- A real "N of 50 units" headline per BOM line (and maybe an overall per-project rollup), not raw
  quantities.
- A bulk action that applies to **every BOM line at once** for a chosen set of units — "receive lot
  for units 1–10 across every line," "allocate this lot," "route this lot to Production/Dispatch" —
  instead of one line at a time. This is the same shape as the disposable script this session had
  to write, made into a real UI feature instead of a one-off.
- A real link from the master's own page into each child's own material list, so "open unit 7's BOM"
  is a click, not a URL guess.

## New feature ask, not built yet — Procurement defines the lots

Raised directly, explicitly deferred ("do not work on it right now"): **Procurement should be able
to define, in the UI, which of the 50 units each incoming lot/delivery actually covers** — e.g.
"this PO / this expected delivery is for units 1–20" — decided up front, not improvised later by
whoever happens to run the receive action.

**Why this doesn't exist today:** there is no "lot" entity anywhere in the schema. A "lot" today is
purely an ad hoc set of `child_project_ids` passed into whichever API call is made at the moment
(bundle-allocate, route-to, batch job-cards, batch packing) — nothing persists "Lot 1 = units 1–10"
anywhere, and Procurement has zero UI touchpoint on any of this: allocation/routing is entirely
Stores-gated (`canAccessDepartment(user, 'Stores')` on `AllocationPanel`/`ChildRoutingPanel`).
Procurement's only role in a split order today is the ordinary Enquiry→PO→Received pipeline on the
shared master BOM — identical to a non-split project.

**What it would need, roughly, when picked up:**
- A `lots` concept (name, master project, member unit ids) Procurement can create/edit — probably a
  small new table (e.g. `project_lots` / `project_lot_units`), since nothing today groups units this
  way.
- Procurement-facing UI to define one (which units, tied to which PO or expected delivery) — a new
  panel, likely on the master project's Procurement tab or its own PO flow.
- Stores' own receive/allocate/route actions (and the redesigned bulk UI above) would then let you
  pick a **defined lot** instead of hand-picking units each time — the two features reinforce each
  other, but are separable; the lot *definition* is Procurement's job, *acting* on it stays Stores'.

Not scoped further than this — a real design pass is needed (schema shape, who can edit a lot after
it's been partly received, whether a unit can belong to more than one lot) before writing any code.
