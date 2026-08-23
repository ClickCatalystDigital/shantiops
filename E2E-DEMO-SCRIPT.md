# Full order-lifecycle demo script

A click-by-click (or API-call-by-call) walkthrough of one order moving through every department —
Sales → Design/Engineering → Procurement → Stores → Production → QC → Dispatch → Accounts →
Customer Portal — proving the system behaves as one pipeline, not independently-tested modules.
Full technical write-up (bugs found, accounting verification, reversal proof) is in `SYSTEM.md` §5ak.

Use a clearly-labeled disposable customer/project, e.g. `E2E-DEMO-DELETE-ME`, so it's obvious what
to clean up afterward. Log in as `admin` (or the relevant department head — every step below also
works from that department's own login).

## 1. Sales — customer → quotation → sale order

1. **Sales → Customers → New Customer.** Name `E2E-DEMO-DELETE-ME Pvt Ltd`, an email, phone, city/state.
2. **Sales → Quotations → New Quotation.** Pick the customer, add one line item (e.g. "IBR Steam
   Boiler 500kg/hr"), qty/rate, save.
3. Open the quotation → **Accept** (status → accepted).
4. **Convert to Sale Order** — picks the legal entity (company), creates the Sale Order.

## 2. Design/Engineering — project + BOM

5. **Projects → New Project.** Customer name, pick the Sale Order just created (auto-fills company
   and seeds the full milestone chain + Scope of Supply from the SO's line items), pick a Model
   (series, e.g. CF).
6. Open the project → **Engineering tab → Bill of Materials → Add item.** Material description,
   MOC, size, qty, section. This is the item Procurement will source.

## 3. Procurement — quote → PO

7. **Procurement → Sourcing.** Find the new BOM item, **log a supplier quote** (pick a real
   supplier, unit price, expected delivery).
8. **Procurement → Selection.** Select that quote as the winner — this auto-drafts a PO.
9. **Procurement → Purchase Orders.** Open the draft PO, **Issue** it (flips the BOM line to
   Ordered).

## 4. Stores — receive → issue to Production

10. Open the BOM item, set **Purchase Status → Received** (Stores' GRN action). This automatically
    creates a QC "Incoming Inspection" record and notifies QC/Production.
11. **Issue material to Production** (Stores or Production, from the BOM item or a Job Card) —
    logs a Material Issue.

## 5. Production — job card

12. **Production → Job Card → New.** Pick the milestone this work belongs to (e.g. Marking &
    Cutting), the BOM item, planned qty/dates.
13. Open the job card → **Start**, then **Mark Done** (qty done, qty rejected). The parent
    milestone auto-closes once every job card on it is done.
14. On the BOM item, mark **Production Done** — this is what makes the line eligible for packing.

## 6. QC — inspection → certificate

15. Flip the auto-created **Incoming Inspection** record to **Pass**.
16. **QC → Test Records → New** — log a Hydro Test, result Pass.
17. **QC workspace → Test Certificates → Add certificate** — enter a Material Test Certificate
    (cert no., cast no., plate no., spec, maker, mechanical properties).
18. **QC workspace → Documents → New Document** — auto-seeds the full Form IV A part list (54 rows
    for the SF template). **Bulk-select all parts → link to the certificate** just added.
19. Once every part is linked, **Preview PDF** becomes available. Check **"Share with customer"** —
    this is the QC Head approval gate; only now does the document appear in the Customer Portal.

## 7. Sales → Invoice, Dispatch → Packing

20. Back on the quotation, **Convert to Invoice**, then open the invoice and set status to
    **Issued** (posts the GL entry: Dr Accounts Receivable / Cr Sales Revenue / Cr GST Output).
21. **Dispatch → Departments → Dispatch**, or the project's Dispatch tab → **Generate from BOM** —
    pulls every Production-done BOM line into a new packing list.
22. Open the packing list: link the **Sales Invoice** just issued, set **freight amount** + "paid
    by us", an **e-way bill number**, vehicle/transporter details.
23. Move status **Packed → Dispatched**.
24. Click **Post Freight Expense** — posts Dr Freight Expense / Cr Bank & Cash, visible immediately
    on the Dispatch Register report.

## 8. Accounts — verify

25. **Accounts → Reports → Trial Balance** — confirm both sides moved by exactly the invoice total
    plus the freight amount, still balanced.
26. **Accounts → Journal Entries**, filter by source type `sales_invoice` / `dispatch_freight` —
    confirm both entries and their line-by-line breakdown.

## 9. Customer Portal — the customer's view

27. **Sales → Customers →** open the customer → **Customer Portal** checkbox → enable. This creates
    a portal login and (once a mail provider is configured, see `SYSTEM.md` §6) emails a
    password-setup link.
28. Once the customer sets their password and logs in, `/portal` shows their order card; opening it
    shows the phase stepper and a **Documents** section with:
    - the packing list (View / download)
    - the **Sales Invoice** (visible as soon as issued — no approval step)
    - the **QC Certificate** (visible only after the "Share with customer" checkbox in step 19)

## Cleaning up a disposable run

Everything created above is a real row in the shared dev database. To fully reverse a test run:
delete (in this order) journal entries → packing items/list → invoice items/invoice → QC document
parts/document/certificate → QC records → job card → material issue → supplier quote/PO
items/PO → BOM item → Scope of Supply → milestones → project → sale order items/order → quotation
items/quotation → the portal login → customer, then restore the `counters` rows you advanced
(`project_no`, `quotation_no`, `sale_order_no`, `po_no`, `packing_no`,
`invoice_no:<company>:<financial year>`) to their pre-run values. `scripts/e2e-baseline.mjs` (run
`before`/`after`/`diff`) captures a full snapshot so you can confirm the database is back to exactly
where it started — no manual eyeballing required.
