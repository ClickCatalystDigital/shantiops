# Planning: how it works, in one page

**Planning answers one question before work starts: "Do we have what we need, and if not, who does what next?"**
Open it from the top bar: **Planning** (Production, Stores, Procurement heads).

## The five tabs

| Tab | Who | What you see |
|---|---|---|
| **Material Plan** | Production, Stores, Procurement | Every BOM line: needed, already secured, free stock or remnant that could cover it, on order (and arrival date), still short. One button per line for the next step. |
| **Schedule** | Production | Open Work Orders as bars on a calendar. Red dot = material short or late. "Delayed" = end date passed. |
| **Capacity** | Production | Each workstation, week by week: % of capacity used. Red = over. Click a cell to see which Work Orders fill it. |
| **Cut** | Production | Cut a plate Stores has reserved for you (needs an indent). |
| **Backlog** | Production | Known gaps, not yet built. |

Stores also sees two new columns in **Inventory**: *Planned demand* and *Free after plans*.

## The simplest example

**Project SB-1200 needs 10 MS plates, 10 mm. Production starts 20 Oct.**

1. **Design releases the BOM.** Until then the lines say *BOM not released* and nobody chases them.
2. **Open Planning > Material Plan.** The plate line shows: *needed 10, free stock 6, on order 0, short 4*. Status: **Needs decision**. It is marked **Due soon** if the start date is within a week.
3. **Stores clicks the button** (*Send to Procurement*). Stores also clicks *Reserve* to lock the 6 in stock. Those 6 now read **Covered**.
4. **Procurement orders the other 4.** The line moves to **On order**, with the delivery date from the PO.
   - If the delivery date is **after 20 Oct**, it turns **Late**. Procurement gets an *Expedite* button.
5. **Material arrives.** Stores receives it. QC clears it (shows **Held for QC** meanwhile). The line is **Covered**.
6. **Production raises an indent**, Stores releases, and Production cuts (**Cut** tab). Leftover remnant goes back to stock and is matched to the next project automatically.

**If you can't do the step yourself**, the button says **Ask Stores / Ask Procurement**. It sends that department a task. Nobody has to know who owns what.

## Daily routine (2 minutes)

- **Production head:** Material Plan, filter *Needs attention*. Then Capacity: any red cell this week or next? If yes, move a Work Order or add a shift (*Set capacity*).
- **Stores head:** Material Plan, look for *Needs decision* rows: reserve from stock or send to Procurement.
- **Procurement head:** Material Plan, *Sourcing* and *Late* rows.
- **Everyone** also gets a daily notification when a project starting within 14 days still has uncovered lines.

## What the colours mean

| Status | Meaning |
|---|---|
| In hand / Covered | Received or reserved. Nothing to do. |
| On order | A PO exists and arrives before it is needed. |
| Late | Arrives after production needs it. Chase. |
| Needs decision | Stores must reserve from stock or send to Procurement. |
| Sourcing | Procurement has it, not ordered yet. |
| Held for QC | Received but waiting for inward QC. |
| BOM not released | Design has not released it. Ignored until then. |

## Things to know

- Quantities assume the same unit on the BOM and in stock (the app does not convert units).
- A BOM line not linked to an Item Master row can't be matched to free stock. Fix the link in Engineering.
- Moving a Work Order's dates is done with a Change Note on the Work Order (Schedule is read-only).
- Capacity defaults to one 8-hour shift, 6 days a week, until you set it.
