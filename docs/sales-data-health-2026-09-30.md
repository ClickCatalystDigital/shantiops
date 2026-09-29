# Sales data health check — 2026-09-30

Checked live against the running app and the real database, not just the import scripts' own
output. Everything below was verified by direct query or by clicking through the actual report
screens as a real login. The exhaustive, row-by-row punch list stays in
[manual-review-checklist.md](manual-review-checklist.md) — this page is the short answer.

## The three questions

**Is all the data properly mapped now? No — but the important workflow data is, and the rest is a
known, bounded list, not a mystery.** Customers (9,479), products (1,826, all with a code),
enquiries (3,079), quotations (2,221, and as of today 2,060 of them have real products/prices, not
just a header), sale orders (1,139) and payments (2,162, ₹102.8 Cr) are all real and usable. What's
still incomplete is documented item-by-item in the checklist: ~1,000 orders and ~140 enquiries with
no customer link yet, some products with no price/HSN, no invoices or price lists yet, no sales
targets or branches.

**Can a salesperson start working today? Yes, for new work.** 17 real logins now exist (this was
previously the #1 blocker — the checklist said only 3 as of a few days ago; confirmed live it's now
Sales Head, Amit B, Devansh Trivedi, Srivaari, Sales Desk / Desk2, Sales1/2, and 5 BDM logins,
plus Marketing Head). A logged-in salesperson can create a new enquiry, quote it against the real
product catalog, convert it to a Sale Order, and see it in every report — that whole path was
click-tested and works. What they can't do yet: see their own name pre-filled as owner on the
enquiries already in the system (see below), or use targets/branches (neither is populated).

**Do the reports show properly? Mostly yes — with one real, confirmed gap.** Order Book &
Collections, the Sales Call Funnel, and the plain Quotation Listing all render real, correct
numbers (verified against the DB, not just "the page loaded"). But **Employee Performance 360** and
**Sales Overview** show **₹0 quotation activity for almost the entire imported history** — both
reports only count quotations that aren't `status='draft'`, and 2,217 of 2,221 imported quotations
are `draft` (only 4 are `sent`, and those 4 predate the line-item backfill so they're also ₹0). The
real ₹395 Cr total *is* in the database and *does* show correctly in the Quotation Listing report
and on each quotation's own page/PDF — it's specifically these two aggregate KPI reports that
structurally can't see it. This was a deliberate decision made when the quotations were first
imported (the source never distinguished "drafted" from "sent"), not a bug — but it means these two
reports will look empty until someone decides whether historical "Open" quotes should count as
`sent`.

## Fixed today, no longer an issue

**A fake "salesperson" was appearing in Employee Performance 360.** 2,481 imported enquiries had
their `created_by` field set to the raw import-tag text (e.g.
`import:sales-projection-enquiries-2026-09-29`) instead of being left blank. Since none of those
enquiries has a real owner, the report's fallback logic treated that tag literally as a person's
name, and it showed up as its own row in the team comparison table. Corrected directly — those
enquiries now correctly show as Unassigned, same as every other unowned one. Confirmed fixed live.

## What still needs a person, not more automation

Full detail and CSVs for every line below are in
[manual-review-checklist.md](manual-review-checklist.md).

| Area | What's missing | Why automation can't close it |
|---|---|---|
| Quotation reporting | Employee Performance 360 / Sales Overview show ₹0 quote activity | Needs a real decision: does an "Open" (draft) historical quote count as sent, for reporting? |
| 161 quotations | Still no line items | 335 never had a matched customer; 19 don't exist anywhere in the DB at all; 67 are genuine duplicate rows in the source register with no way to tell apart |
| 709 Shanti Boilers + 61 Techno Fab orders | No customer link | The company name in the order sheet doesn't match any real customer — needs a person to confirm who it actually is |
| Enquiry ownership | Almost no enquiry has a real A/C manager | The imports never carried an owner column; needs an export with stage + owner + value from the current CRM, or manual assignment |
| 1,315 possible duplicate customers | Not merged | Same name but a different code, or only a single-word name — merging blind risks combining two real, different companies |
| 957 products | No HSN code | No sibling product with the same name already has one to copy from — needs a real classification, not a guess |
| GST on backfilled quotations | Stored as one net amount, not CGST/SGST/IGST | No reliable state-code history for these old customers/quotes; several real ones show GST as a subtraction rather than an addition — worth asking before trusting them for tax purposes |
| Invoices, price lists, targets, branches | 0 rows each | Genuinely new data entry, not an import gap — nothing exists yet to import from |
