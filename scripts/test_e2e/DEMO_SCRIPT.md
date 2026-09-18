# Demo script: Phases 1-4 + Trade (browser walkthrough)

One story: material comes in, gets built, gets packed. Then a separate trade order.
Login: `admin` sees everything. Or switch to each head to show who does what.

## Before you start
- Use any active project that has a BOM structure node (or `TEST-PROJ`).
- Stores > **Material Demand** > cog > set **Match settings** to **Auto**.
- Pick 3 pipe items from Item Master (Item A, B, C). Trade part uses 2 more (D, E).

## Part 1 - Project material (Phases 1-4)

**1. Stock auto-match (Phase 1)** - Stores
1. Stores > **Inventory** > add Item A with stock 10.
2. Engineering > **Purchase Requests** > raise 1 line for Item A, qty 4.
3. Stores > **Material Demand** shows it **Auto-reserved**. Procurement never sees it.

**2. Buy it (Phase 2)** - Engineering, Procurement, Stores, QC
1. Engineering > raise a PR with Item B and Item C (different items, no stock).
   - Item B = made in-house (leave "Requires manufacturing" ticked).
   - Item C = bought-out (**untick** "Requires manufacturing").
2. Procurement > **Enquiry** > add a supplier quote for each.
3. Procurement > **Selection** > pick the supplier (a draft PO is created).
4. Procurement > **Purchase Orders** > **Issue** the PO.
5. Stores > **Receive a Delivery** > search the item > **Receive** (full qty).
6. QC > **Approvals > Inward** > open it > **Approve**.
   - Until QC approves, the stock is not usable. Show that.

**3. Route it (Phase 3)** - Stores, Production
1. Stores > **Allocate** > tick **Production** for Item B, **Dispatch** for Item C > Apply.
2. Production > **Material Indent** > Item B is listed (Item C is not) > create the indent.
3. Stores > **Material Indents** > **Release** the full qty.
4. Stores > **Issued to WIP** shows it.

**4. Build it (Phase 4)** - Production, QC
1. Production > **Job Card** > new card on a Production milestone, link Item B.
2. Log time on the card. Move it to **In progress**, then **Done**. The milestone auto-completes.
3. Production > **BOM** tab > tick **Prod. Done** for Item B (this is manual on purpose).
4. Optional QC hold demo:
   - Production > **Work Orders** > new > add a route step with a QC checkpoint > Release > generate Job Cards.
   - Try **Done** - it is blocked ("Held for QC").
   - QC > **Hold Points** > **Release**. Now Done works.

**5. Pack it** - Dispatch
1. Dispatch > **Packing Lists** > generate draft from BOM. Items B and C are on it.
2. Mark **Packed** > **Submit for approval**.
3. QC (Approvals > Pre-Dispatch) and Production (Approvals) both **Approve**.
4. Dispatch marks it **Dispatched**.

## Part 2 - Trade order (Phase T)
Sales raises it against a Sale Order. No project, no Design.

1. Stores > **Inventory** > add Item D with stock 20. Item E has no stock.
2. Sales > **Sale Orders** > create an order.
3. Sales > that order > **Request from Stores** > 2 lines: Item D (qty 6), Item E (qty 4).
4. **Item D** (has stock): shows reserved at once. Stores > **Ready to Issue** > **Issue**.
5. **Item E** (no stock): follow Part 1 step 2 (quote, select, PO, receive, QC approve).
   - After QC approves it is reserved to the trade request automatically.
6. For D and E, untick **Requires manufacturing** on the line, or Dispatch will not see them as ready.
7. Dispatch > **Pending Items** > trade lines show as `SO #...` > generate the packing list.
8. Same approvals as Part 1 step 5, then **Dispatched**.

## Things to know before the demo
- Step 6 of Part 2 is the one to rehearse. If Dispatch shows nothing, that box is why.
- Step 7 of Part 2: I did not click-test the trade packing button in the UI. Try it once first.
- Rows you create by hand in the demo are not cleared by `reset_all.py` (it only clears the scripted test data). Use a throwaway project.
