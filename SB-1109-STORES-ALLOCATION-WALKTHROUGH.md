# Walkthrough: Stores allocation + routing on SB-1109-01-50

Real project (id 61), real customer (HKM CHARITABLE FOUNDATION), real 50 child units
(SB-1109-01 … SB-1109-50). This is a hands-on guide to actually use the new feature on this real
order — not a demo. Do this on the running dev server at `http://localhost:3012`, logged in as
`stores_head` / `stores_head123` (or `admin` for anything Stores can't reach).

## Before you start — a real gap, checked directly against the database

**Nothing has been received yet on this order.** I queried the live DB before writing this: the
FEED PUMP line (`FEED PUMP (TYPE-CENTRIFUGAL) & MOTOR`, qty `2 Nos` per unit) is still sitting at
`purchase_status: Enquiry`, and there are **zero** rows in the receiving ledger for any BOM line on
this project. So "Stores has received 20 of 50 boiler feed pumps" describes something that happened
physically, but hasn't been logged in the app yet.

This means allocation can't start until a receipt exists (allocation is bounded by
`received − already allocated`; with 0 received, 0 is available). **Step 1 below does that first.**

If the physical receipt already happened for a different line than the feed pump (or a different
quantity), swap in the real numbers — the steps are the same regardless of which line.

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
