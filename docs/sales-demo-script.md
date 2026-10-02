# Sales demo — one page

Log in as `sales_head` / `sales_head123`. Email is in **Test** mode, so nothing reaches a real customer. Use a fake name like "Demo Foods Pvt Ltd" so it is easy to spot and delete.

## 1. Enquiry
Sales → **Enquiries** → **New Enquiry**. Fill Organization, Address, Mobile, pick a Stage (Lead - Cold), add a Product line → **Create enquiry**.
Click the enquiry row → **Add to Diary** → write "called, wants quote", set a next follow-up date → Save.

## 2. Enquiry → Customer (the link)
On the enquiry sheet click **Create Commercial Offer**. If a similar customer exists, choose *use existing* or *create new*. That is the only step that makes the customer; the enquiry stays as it is and is just linked to it.

## 3. Quotation
The offer form opens with the enquiry's products → check rates/GST → **Save**. In the next box press **Send Email** (goes to the test address or is only logged). The enquiry moves to **Hot Offers**.
Sales → **Quotations** → set the status dropdown to **Accepted**.

## 4. Sale Order
On the accepted quotation click **Convert to SO** (or on the enquiry click **Create PO**). Sales → **Sale Orders** → click the **document icon** on the new order to add items, discount, GST, freight → **Save**. Click the **upload icon** to attach the customer's PO PDF.
Design and PMs get a bell notification. Log in as `design_head` → **Projects → New Project** → pick this Sale Order → create.

## 5. Payments
Sales → **Order Tracker**: change the Stage dropdown and Status. **Payment Log → Add payment** for the order (row turns green when fully paid).

## 6. Invoice and credit note
Sales → **Invoices** → **Add Sales Invoice** (or **Convert to Invoice** on the quotation) → set status **Issued**, later **Paid**. **Add Credit Note** → pick the invoice, enter the return amount.

## 7. Customer portal
Sales → **Setup → Portal Access** → find the customer → **Enable** → **Copy link** → open it in a private window, set a password, look at the order.

## 8. Lost deal (optional)
On another enquiry click **Order Lost** → pick a reason → Sales → Reports → **Lost Reasons**.

## 9. Plan the week (Weekly Planner)
Sales → **Enquiries → Weekly Planner**. Each day shows the follow-ups planned in the Diary; change a date to move one, and (Sales Head) pick another person to hand it over — they get a bell notification. The red box lists follow-ups that are overdue with nothing logged since.

## 10. Sell more to existing customers
Sales → **Customers** → open a customer → **Add-on & cross-sell opportunities** → **Create enquiry** (warranty ended / ending) or **Offer an AMC**. The enquiry opens pre-filled, tagged *Existing Customer* and linked to the customer.

## 11. AMC and preventive maintenance
Sales → **Deals → AMC**. Open a contract: days committed / left, value, received, cost and profit. Add a cost entry; the profit updates. **Preventive maintenance due** lists the next visit per contract and per item under warranty; **Schedule visit** puts it on the Home calendar.

## 12. Library
Sales → **Setup → Library** → upload a mailer / presentation / price list → everyone in Sales can download it.

## 13. MIS reports
Reports → **Sales** → **MIS** group (Employee Wise / Source Wise / Branch Wise Order, Win-Loss, Funnel Ageing, Order Time Cycle, Lead Generation, Call Log, Last Contact, Employee Daily Work, Employee Movement, New Customer Added, Selling vs Cost Price, Employee Usage, AMC Profitability). Every report downloads as CSV / Excel. The other Sales reports sit under **More Sales reports**.

Demo AMC contracts were added with `node --env-file=.env.local scripts/seed-demo-mis.mjs --apply`; remove them with `--rollback`.

## Clean up
Delete demo enquiries from the enquiry sheet (**Delete**), demo quotations with the bin icon, and tell me the order/invoice numbers so I remove them from the database.
