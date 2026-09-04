# Multi-unit BOM split — how to test this yourself in production

This is a plain, click-through checklist for verifying the multi-unit split feature works
correctly, department by department. No technical background needed — just follow the steps and
compare against "what should happen."

Background: full design/build history is in `MULTI-UNIT-SPLIT-DESIGN.md`. This feature lets you
build a BOM **once** for a multi-unit order (e.g. 50 boilers under one commercial order), then
split it into 50 real, individually-trackable unit projects — so QC/Production/Dispatch can track
each physical unit separately, while Procurement/Stores keep working the order as one aggregate.

**You already have a real example to test against**: `SB-1109-01-50` (HKM CHARITABLE FOUNDATION)
has already been split into `SB-1109-01` through `SB-1109-50` — 50 real unit projects. You can use
these to check every screen below without creating anything new. If you want to test the *split
action itself* end to end, use a different, brand-new order — a master can only be split once, and
`SB-1109-01-50` is already used up.

---

## 1. Design / Engineering — build the master BOM, then split it

1. Open a multi-unit project's BOM workspace (Engineering → BOM Structure, or `SB-1109-01-50`'s own
   page).
2. Confirm the **Unit Count** field (next to the template buttons) shows the right number — for
   SB-1109-01-50 this is **50**.
3. Confirm **Release BOM** has been done at least once (a released project shows a green check /
   revision number; this is required before Split becomes available).
4. Look for the **"Split into N Units"** button (or, if already split, a **"N units created"**
   badge) right next to Unit Count. For SB-1109-01-50 you should see the badge, not the button.
5. ✅ **Pass** if: the button/badge is visible, the count matches Unit Count, and clicking the badge
   takes you to the Projects list.
6. If testing a fresh split on a different order: click "Split into N Units", read the confirmation
   warning carefully (**this cannot be undone**), confirm, and wait — for a large unit count (50+)
   this can take over a minute due to real network latency. Don't refresh or click again while it's
   working.

## 2. Procurement — should see NO change at all

1. Open Procurement's workspace (Sourcing / Selection / Purchase Orders / Status tabs).
2. Search for `SB-1109`.
3. ✅ **Pass** if: you see exactly **one** set of BOM lines/PRs/POs, all against the master
   `SB-1109-01-50` — you should **not** see 50 separate copies, and you should **not** see the
   individual `SB-1109-01`..`SB-1109-50` projects anywhere in this workflow. Procurement always
   works the aggregate order, never individual units.

## 3. Stores — receive against the master, optionally allocate to specific units

1. Open the master project's page (`SB-1109-01-50`) and find the **"Material allocation to unit
   projects"** card.
2. If nothing's been received yet, it should say so plainly (e.g. "Nothing received yet —
   allocation becomes available once Stores logs a receipt.") — this is correct, not a bug.
3. Log a real (or test) receipt against one BOM line from the Stores workspace, exactly as you
   normally would.
4. Go back to the master project's Allocation card — the received quantity should now be showing,
   with an option to allocate some or all of it to specific unit projects (e.g. "allocate 10 of the
   50 received bolts to units 1–5").
5. ✅ **Pass** if: allocating to specific units works, and the *un*-allocated portion still shows as
   available at the master level (allocation is optional, not forced).

## 4. Production — batch-create job cards across units

1. Open the master project's page. Find the **"Raise job cards across units"** card.
2. Pick a milestone (e.g. "Shell Welding"), a quantity, and check a few real unit boxes (e.g.
   `SB-1109-01`, `SB-1109-02`, `SB-1109-03`).
3. Click "Create job card(s)".
4. ✅ **Pass** if: you get a success toast naming how many job cards were created, and each of
   those 3 units' own project pages now shows its own separate job card for that milestone — **not**
   one shared job card, three distinct records.

## 5. QC — batch-create statutory documents across units

1. Same master project page, **"Raise statutory documents across units"** card.
2. Fill in Maker's No. prefix and Document ID prefix (e.g. `SB-1109` / `SB-1109-DOC`), pick the
   company, fill in whichever boiler specs you have to hand, check a few unit boxes.
3. Click "Create document(s)".
4. ✅ **Pass** if: each selected unit gets its **own** QC statutory document, with its **own**
   maker's number (auto-suffixed per unit — e.g. `SB-1109-01`, `SB-1109-02`, not one shared number),
   its own document ID, and its parts list already filled in from the master's BOM at the correct
   per-unit quantity.

## 6. Dispatch — batch-create packing lists across units

1. Same master project page, **"Generate packing lists across units"** card.
2. Check a few unit boxes, click "Generate for N unit(s)".
3. ✅ **Pass** if: each selected unit gets its own packing list, pre-filled from the master's
   ready-to-pack BOM lines at the correct per-unit quantity (not the master's full 50× quantity).
4. Run the exact same action again on the same units. ✅ **Pass** if: nothing gets duplicated — the
   toast should say something like "0 created (N already up to date)".

## 7. Projects list — the rollup view

1. Open `/projects` and search `SB-1109`.
2. ✅ **Pass** if: you see **one row** for `SB-1109-01-50` showing something like "N of 50 units
   done", expandable to show the individual children — **not** 51 separate top-level rows cluttering
   the list.

## 8. Executive dashboard — portfolio view

1. Open the Executive dashboard.
2. ✅ **Pass** if: `SB-1109-01-50` appears **exactly once** in KPIs/forecast/risk lists — none of its
   50 children should appear there as separate entries. (They still show up correctly on
   department-level, project-scoped screens like Operations — just not on this portfolio-level one.)

## 9. Customer Portal — safety check

1. Log in as (or check) a customer account linked to the HKM CHARITABLE FOUNDATION order.
2. ✅ **Pass** if: the customer can see the master order as normal, and **cannot** see or reach any
   of the individual `SB-1109-01`..`SB-1109-50` child projects, even by guessing the URL.

---

## If something looks wrong

- **A button/panel is missing entirely**: hard-refresh the page first (browsers can cache a stale
  version of a page that was just updated). If it's still missing, note exactly which department,
  which screen, and whether you're logged in as an admin/PM or a specific department head — access
  is department-gated, so a head who isn't granted that department correctly won't see it.
- **Numbers don't match** (e.g. a packing list shows the full 50× quantity instead of 1×): note the
  exact project/BOM line and screen — this is the kind of concrete detail that makes a real bug
  fixable quickly.
- **Anything duplicates on a repeat click**: these batch actions are designed to be safely
  re-runnable (skip what's already done, never create a second copy) — a duplicate is a real bug,
  worth reporting with the exact steps.
