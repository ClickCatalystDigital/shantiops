# What completes each milestone

Verified directly against `lib/milestone-auto.js` and the real project-page buttons — not guessed.

## Why finishing one department doesn't "start" the next one

Completing the last milestone in a department (e.g. Design's "Release All Drawings") does **not**
automatically flip the next department's first milestone to "in progress" — checked directly in
`lib/notify.js`'s `fireHandoff()`. It only ever inserts a **notification** for that next department
("Handoff from Design"), never touches the next milestone's own status or start date. This is
deliberate, not a bug: a real department (Procurement, Production, etc.) genuinely hasn't started
until someone there does real work — logs a quote, raises a job card, whatever. A milestone only
ever shows "in progress" once a human clicks **Start** on it, or its own automation fires
(see the table below), and it only ever shows **done** once that real work is actually finished.

So the correct read of "Design & Engineering: Completed, Material Procurement: Upcoming" is: Design
really is done, Procurement genuinely hasn't done anything yet, **and Procurement's head really did
get notified** the moment Design finished (check their notification bell) — the system worked
exactly as designed, it just doesn't fake a status change nobody's actually done.

**Two milestones fire an extra notification beyond the normal department handoff**, worth knowing
before force-closing them for testing: closing the last Procurement milestone (**Procured**) also
notifies **QC** ("All items procured — ready to prepare inspection records"); closing
**Commissioning** also notifies **Sales and every PM** that the whole project is complete.

| Milestone | Action to complete it |
|---|---|
| Design | Design Head clicks **"Approve Design"** on the project page's Design panel. No automation. |
| Submit Design Approval | Auto-completes once **every** customer-visible drawing on the project has been approved by the customer (portal → drawing → "Approve"). That button only works while the drawing's own status is `under_review`; if a Design Head already fast-forwarded it straight to `approved`, the customer can never click it, and the only path left is opening the milestone and clicking **Close**. |
| Release BOM / PR | Clicking **"Release BOM"** (Requests → Release BOM tab) completes this automatically. |
| Release All Drawings | No automation anywhere. Open the milestone and click **Close**. |
| Procurement: Enquiry / Comparison / Ordered / Transit / Procured | Auto-complete as real Procurement work happens — each one needs **every** BOM line on the project to have moved at least that far (a quote logged, a supplier selected, a PO issued, marked in transit, then Received/Cancelled/In-Stock). No button to click; just work the BOM normally in `/procurement` and these tick off themselves. |
| Marking/Cutting, Drilling, Shell Welding, Site Marking, Welding (FURA), Box Up, Box Up Welding, Tubes & Stay Rods, Pad Plates, Smoke Box, Refractory, Painting (12 Production milestones) | Auto-complete once every Job Card raised against that specific milestone reaches **Done** on the Job Card board. No cards raised yet = stays pending. |
| Hydro Test | Auto-completes once a Hydro Test record is logged with result **Pass** (Production's own Hydro Test panel). |
| Packing & Labeling | Auto-completes once a packing list for the project reaches **Packed** or **Dispatched**. |
| Site Installation | Installation Head clicks **"Mark complete"** on the project page's Installation panel. No automation. |
| Commissioning & Handover | Same — **"Mark complete"** button. Also the one milestone that notifies Sales/PMs the whole project is done. |

**Universal fallback, works on any of the above**: open the milestone in the project page's editor and click **Close** — same PATCH every automated path and every dedicated button uses under the hood, so it's always a safe, real way to force one through.

## Correction — the 5 Procurement milestones were reverted on SB-1109-01-50

The 5 Procurement milestones described above were force-closed on that real order for a quick demo,
then **reverted back to pending** once we caught that the underlying BOM data didn't back it up (all
203 lines were still sitting at `Enquiry`, zero quotes, zero POs, zero receipts). Two lessons from
that, both worth remembering:

1. **`Received` (the BOM line status) is meant to be Stores' domain only** — via the real Receive
   action, which supports genuine partial deliveries (a receipt ledger, `bom_item_receipts` — a line
   only flips to `Received` once the cumulative received quantity actually meets what's required).
   Procurement's own Status-tab dropdown *can* technically set a line straight to `Received` as a
   manual override — that's a general "fix bad data" escape hatch, not the intended workflow. Treat
   it the same way as force-closing a milestone: a last resort, never a shortcut for real progress.
2. **On a split order (SB-1109-01-50, 50 real units), "Material Procurement" in the customer portal
   is now a genuine per-unit count** — "Upcoming (0 of 50 units)," ticking up unit by unit as Stores
   actually allocates real received material to specific units in lots. It is driven by the
   allocation feature (`getChildRoutingBoard`), completely separate from the 5 whole-project
   Procurement milestones above, which still only ever mean "every one of ~180 BOM lines cleared this
   stage" — never "N of 50 units." Don't confuse the two: closing the 5 milestones by hand will
   **not** move the portal's per-unit figure at all; only real Stores allocation does.

**What actually happened next, for real (2026-09-05):** Stores received Lot 1 + Lot 2 (10 units'
worth each, units 1–20) across every one of the 181 real BOM lines, bundle-allocated Lot 1 to units
1–10 and Lot 2 to units 11–20, then routed units 1–10 to Production and units 11–20 to Dispatch. The
portal now correctly reads `Material Procurement — In progress (20 of 50 units)`, with Manufacturing
and Quality Testing both still correctly `Upcoming (0 of 50 units)` — routing material doesn't start
either of those; only a Job Card actually reaching Done, or a passing Hydro Test, does. 10 real Job
Cards + Material Indents exist for units 1–10 (Production's own next step from here), and 10 real
packing lists exist for units 11–20 (Dispatch's own next step). The 5 whole-project Procurement
milestones themselves are still `pending` — correctly untouched by any of this, per point 2 above.
