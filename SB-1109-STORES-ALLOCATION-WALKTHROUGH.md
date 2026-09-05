# Walkthrough: Stores allocation + routing on SB-1109-01-50

Real project (id 61), real customer (HKM CHARITABLE FOUNDATION), real 50 child units
(SB-1109-01 … SB-1109-50). This is a hands-on guide to actually use the new feature on this real
order — not a demo. Do this on the running dev server at `http://localhost:3012`, logged in as
`stores_head` / `stores_head123` (or `admin` for anything Stores can't reach).

## Correction from the first version of this doc

The original version of this walkthrough used the FEED PUMP line as if it were the whole scenario.
That was wrong — since the BOM is **one shared list, repeated 50 times** (one master `bom_items`
row per real material, multiplied by whichever unit needs it), "Stores received 20 of 50 units'
worth" means **every one of the ~180 real BOM lines** has 20 units' worth in hand, not just one
line. A real physical delivery of "20 boilers' worth of material" is a truck (or several) carrying
every part those 20 units need — plates, pumps, valves, fasteners, everything — not one line item.

**The steps below are still the correct mechanism** — receive, bundle-allocate, route — and are
genuinely worth doing by hand on **one line** if you want to see the UI work end to end. But doing
that for all ~180 lines, one at a time in the browser, isn't realistic — that's exactly why the real
lot-receiving pass for this order was driven by a script that calls the same real routes described
below, once per line, rather than by hand. If you want to feel the mechanism yourself, pick any one
BOM line not already touched by that script and walk it through Steps 1–3 below — the UI behaves
identically whether it's the one line you're testing or the ~180 lines a real lot covers.

## Before you start — checked directly against the database

**Update (2026-09-05): the real full lot pass has now run.** All 181 lines have Lot 1 + Lot 2
logged (20 of 50 units' worth received on every line), bundle-allocated to units 1–20, and routed
(units 1–10 → Production, units 11–20 → Dispatch). Units 21–50 still have nothing received/
allocated/routed — that's genuinely the next lot whenever it arrives. Re-check the real state before
assuming either way if picking this up again later; the steps below are unaffected either way.

This means allocation can't start until a receipt exists (allocation is bounded by
`received − already allocated`; with 0 received, 0 is available). **Step 1 below does that first.**

## Step 1 — Log the receipt (Stores' existing Receiving flow, not part of this new feature)

1. Go to `/projects/61` (the SB-1109-01-50 master project page).
2. Find the BOM table (Engineering panel, or wherever your Stores view shows it) and locate the
   **FEED PUMP (TYPE-CENTRIFUGAL) & MOTOR** row.
3. In the **GRN No. & Date** column, click **Receive**.
4. Fill in the real supplier, GRN number, and invoice number (all required — this is the official
   receiving flow, no shortcuts), and the quantity actually received. If 20 units' worth arrived and
   the line is `2 Nos` per unit, that's **40 Nos** total (20 × 2) — enter the real number for what
   physically arrived, in the line's own units.
5. Submit. The line's own `purchase_status` won't flip to "Received" unless the FULL required
   quantity across all 50 units arrived (that's existing, pre-existing behavior, not part of this
   round) — a partial receipt like this stays at whatever status it was, but the receipt itself is
   now logged and available to allocate from.

## Step 2 — Bundle-allocate the received material to specific units

Still on `/projects/61`, scroll to the card titled **"Material allocation to unit projects"**.

1. Find the FEED PUMP row — it now shows **Received: 40**, **Allocated: 0**, **Available: 40**.
2. Below the single-unit control (unit picker + qty box + Allocate button), there's a second control:
   a row of checkboxes, one per child unit (SB-1109-01 … SB-1109-50), and a button reading
   **"Allocate 1 unit's worth to N"**.
3. Check the 20 units you actually have pumps for (e.g. SB-1109-01 through SB-1109-20 — check each
   box; there's no select-all yet, see the note at the bottom).
4. Click the button. It reads `Allocate 1 unit's worth to 20` once you've checked 20. This creates
   20 separate allocation records, 2 units each (40 total) — the quantity is computed for you, never
   typed by hand.
5. You'll see a toast confirming `Allocated 1 unit's worth (2) to 20 unit(s) — 0 left available` (or
   whatever's left if you allocated fewer than the full 40).

## Step 3 — Route each allocated unit to Production or Dispatch

Right below the allocation card is a new card: **"Route material to Production or Dispatch, per
unit"**.

1. It lists every BOM line with at least one unit ready to route. Click the FEED PUMP row to expand
   it — you'll see the same 20 units you just allocated to, listed as checkboxes.
2. Decide, for each of those 20: does this specific unit's pump go straight to Production (it still
   needs work before shipping), or straight to Dispatch (ready to pack now)? This is a real decision
   only you/Stores can make — the app deliberately never guesses it.
3. Check the units going to Production, click **→ Production**. Check the ones going to Dispatch,
   click **→ Dispatch**. (You can split the same 20 across both in two separate clicks — check a
   subset, route it, then check the rest and route those.)
4. The "Show all" toggle (top-right of the card) lets you come back later and see/change decisions
   you've already made, not just the ones still awaiting a choice.

## Step 4 — See the result from a specific unit's own page

Open one of the units you just routed, e.g. `/projects/112` (SB-1109-01, if that's one you picked).
Scroll to **"This unit's material list"** — the FEED PUMP row now has a **Status** column showing
either `→ dispatch`, `→ production`, or `2/2 allocated` for one you haven't routed yet.

## Step 5 (optional) — actually generate packing lists for the ones routed to Dispatch

Still on `/projects/61`, if you're logged in as (or switch to) `dispatch_head`: find the
**"Generate packing lists across units"** card, check the units you routed to Dispatch in Step 3,
click **Generate for N unit(s)**. Each gets its own real packing list containing only the FEED PUMP
line, at qty 2 — units you routed to Production are silently skipped (not an error) since nothing's
routed to Dispatch for them yet.

## Step 6 (optional) — draw the routed-to-Production material with a real Job Card + Material Indent

For a unit you routed to Production instead of Dispatch: Production first needs a **Job Card**
(Production's own workspace → Job Card board → create one against that unit's own milestone, e.g.
"Marking, Cutting, Rolling Shell" — or use the "batch across units" action if raising the same
milestone for several units at once). Then, from that Job Card, raise a **Material Indent**
(Production's Indent screen) listing the BOM line(s) now routed to Production for that unit and the
quantity needed — this is the real, formal "request material from Stores" document
(`material_indents`/`material_indent_items`). Stores then **releases** against the indent, which is
the actual moment material leaves stock for the shop floor (`material_issues`). Routing material to
Production only makes it *available* to request this way — it doesn't create the Job Card or Indent
by itself.

## Optional — QC: link one certificate across several units' documents at once

This part only matters once QC has created statutory documents for these units (via QC's own
"Raise statutory documents across units" batch action, if not done already). Once two sibling
documents both have a part for the same BOM line:

1. Open one child's QC document, click **Link certificate…** on that one part.
2. In the picker dialog, before choosing a certificate, check **"Also link this part on sibling
   units (multi-unit split)"**.
3. Pick the certificate. It links here, plus the same part on every sibling unit's own document, in
   one click.

## Things you'll bump into at 50-unit scale (known, not bugs)

- **No "select all" checkbox** in either the allocation bundle control or the routing panel — you're
  clicking each of the 20 (or however many) individually. Matches the existing Dispatch batch panel's
  own pattern, which has the same limitation; not something new to this feature.
- **No cross-unit rollup view for Production** — Production sees "what's routed to me" only by
  opening one child project at a time (Step 4). There's no single screen listing "all 50 units, all
  their routed-to-Production lines" yet.
- **Routing is per BOM line, not per unit** — if you have several bought-out lines going through this
  same flow, you route each line's units separately (the panel groups by line, not by unit).
