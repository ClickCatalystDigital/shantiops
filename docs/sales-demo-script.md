# Sales demo — one page

Log in as `sales_head` / `sales_head123`. Email is in **Test** mode, so nothing reaches a real customer. Use a fake name like "Demo Foods Pvt Ltd" so it is easy to spot and delete.

## 1. Enquiry
Sales → **Enquiries** → **New Enquiry**. Fill Organization and Address (Mobile/Email are optional but **add an Email** if you want to show the offer email), pick a Stage (Lead - Cold), add a Product line → **Create enquiry**.
Click the enquiry row → **Add to Diary** ("Activities & Plan") → write what happened in *Action Taken*, set a *Future Date* and *For A/C Manager* → **Update** → **Confirm** (keeps or changes the funnel stage).

The enquiry sheet is organised in rows: organization · ownership & status · tasks/notes on top, the action bar, then tabs (Profile, Contacts, Address, Statutory, Competitors, Products, Activities & Plan, Business Details, Follow Up). Contacts/Address/Statutory/Business save on the customer — press **Save to customer** first if the enquiry has none.

## 2. Commercial Offer (this also makes the customer)
On the enquiry sheet click **Create Commercial Offer**. If a similar customer exists, choose **Use this** or **Create new customer** (Cancel stops, nothing changes). The enquiry stays as it is and is just linked to the customer.
The quotation form opens with the enquiry's products → check Rate/GST → **Create Quotation**. The enquiry moves to **Hot Offers** right now.

## 3. Send the offer
The next box is **Send Commercial Offer**: type the customer's address in **To** → **Send Email**. Email is in Test mode, so it is only logged ("not sent to the customer"). The quotation stays **draft**.
Sales → **Quotations** → set the status dropdown to **Accepted**.

## 4. Sale Order (Create PO)
On the enquiry click **Create PO** → a small box asks Expected Date, Week, Stage (Order Received) and **Continue the Sales Call?** (default **No**, which also **closes the sales call**) → **Continue**. The order sheet opens: the enquiry's items are pre-filled — press **Save Items On Order**, add discount/freight, **Save Payment Terms**. Attach the customer's PO PDF with the upload icon in Sales → **Sale Orders**.
(From an accepted quotation you can also use **Convert to SO**.) Design and PMs get a bell notification. Log in as `design_head` → **Projects → New Project** → pick this Sale Order → create.

## 4b. Close Sales Call
Create PO with "Continue = No" already closed it, and the button then reads "Sales Call closed". To close a call without an order, open another enquiry → **Close Sales Call** (stops the follow-up reminders; the stage is unchanged). Editing the enquiry later reopens it.

## 5. Payments
Sales → **Order Tracker**: change the Stage dropdown and Status. **Payment Log → Add payment** for the order (row turns green when fully paid).

## 6. Invoice and credit note
Sales → **Invoices** → **Add Sales Invoice** (or **Convert to Invoice** on the quotation) → set status **Issued**, later **Paid**. **Add Credit Note** → pick the invoice, enter the return amount.

## 7. Customer portal
Sales → **Setup → Portal Access** → find the customer → **Enable** → **Copy link** → open it in a private window, set a password, look at the order.

## 8. Lost deal (optional)
On another enquiry click **Order Lost** → pick a reason (add the competitor if known) → Sales → Reports → **Lost Reasons**.

## 9. Plan the week (Weekly Planner)
Sales → **Enquiries → Weekly Planner**. Each day shows the follow-ups planned in the Diary; change a date to move one, and (Sales Head) pick another person to hand it over — they get a bell notification. The red box lists follow-ups that are overdue with nothing logged since.

## 10. Sell more to existing customers
Sales → **Customers** → open a customer → **Add-on & cross-sell opportunities** → **Create enquiry** (warranty ended / ending) or **Offer an AMC**. The enquiry opens pre-filled, tagged *Existing Customer* and linked to the customer.

## 11. AMC and preventive maintenance
Sales → **Deals → AMC**. Open a contract: days committed / left, value, received, cost and profit. Add a cost entry; the profit updates. Log each payment under **Receipts** (date, amount, who took it) and pick the **Service engineer**; the three AMC reports (Due, Received, Service Engineer wise) read these. **Preventive maintenance due** lists the next visit per contract and per item under warranty; **Schedule visit** puts it on the Home calendar.

## 12. Library
Sales → **Setup → Library** → upload a mailer / presentation / price list → everyone in Sales can download it.

## 13. Reports
Reports → **Sales**: reports are grouped by what you want to know — **Overview**, **Sales Order / AMC Order** (Sales Order vs Collection, Dispatch Sales Order Report, Customer Wise Monthly AMC Due / Received, Service Engineer wise AMC Received, Sales Register, AMC Profitability), **Funnel & Enquiries**, **Order Analysis** (by employee, source, reference, branch), **Sales Calls & Follow-up**, **Quotations & Pricing**, **Team Performance**, **Customers & Feedback**. The company dropdown at the top right narrows orders, quotations, invoices and payments; enquiry and follow-up reports are shared by both companies. Most reports download as CSV / Excel.

Demo AMC contracts were added with `node --env-file=.env.local scripts/seed-demo-mis.mjs --apply`; remove them with `--rollback`.

## Clean up
An enquiry that already has a customer/order can't be deleted from the screen. Delete demo quotations with the bin icon and tell me the enquiry/order/invoice numbers so I remove them from the database.

## 14. Team and Settings (Sales Head)
Cog icon (top bar) → **Settings** → **Sales** section: **Team** → **Add member** (pick an HR person in Sales, set username + password), change **Member/Head**, **Reset password** (shown once), **Switch off**. **Email** (company mailboxes, test/live) and **Data retention** are the other tabs. Members see only "My Email" under Sales → Setup; **Portal Access** stays in Setup for everyone in Sales.

## 15. Trade Requests
Sales → **Enquiries → Trade Requests** → tick open requests → **Accept as SAS order** (pick the customer if asked). The new SAS order appears in Sale Orders; price it, then **Request Stores**.
