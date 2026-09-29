# Manual review checklist — Sales data (2026-09-25, updated 2026-09-30)

Everything a person still has to check or decide after the imports. Tick an item when it's done.
Details and full lists are in the linked files; this page is only the to-do list.

Counts were checked against the live database on 2026-09-25, and re-checked/updated on 2026-09-30
after a round of bug fixes and cleanup (see the bottom of §9 and §7).

**New, as of 2026-09-30: every page below now has real search, filter and per-row Delete.**
Customers, Quotations, Sale Orders (Payment Tracker), and Enquiries can all be reviewed and cleaned
up directly in the app — no script needed for routine cases. Delete always refuses (with a clear
reason) if the record has real linked activity (an order, invoice, payment, project, etc.) — it's
only for genuine duplicates/test rows/mistakes with nothing built on them yet. Enquiries also got a
one-click "assign the same A/C Manager to many selected rows at once" bar, since that's the single
biggest data gap below (§6/§8).

---

## 1. Orders ↔ projects — 6 links not made automatically

56 projects were linked to their Sale Order automatically. These 6 need a person. Fix in
**Projects → open the project → Edit → Sale Order**. Full list: [order-project-link-review.csv](order-project-link-review.csv).

- [ ] **SB-1040**: project is Blypin Enterprises / Shanti Techno Fab, order SB-1040 is SPECTRAA TECHNOLOGY / Shanti Boilers. Which is right: the project's company/customer, or the order?
- [ ] **SB-1114**: project customer Baud Distilleries, order SB-1114 customer Satupali O.S Shop. Wrong order number, or wrong customer?
- [ ] **SB-1057**: a test project ("TEST-STORES-DEMO"). The real order SB-1057 is SUMANTH PUFF RICE. Delete the test project? See section 7.
- [ ] **STF-IBR-060**: no order with exactly this number. The closest is `STF-IBR-060-EXP-03` (Sunny Processors). Is that the order for this project?
- [ ] **STF-IBR-053-C**: extra order for Normada, which is already linked to `STF-IBR-053`. A project holds one order. Is `-C` a separate job (make a project), or part of the same one (leave it)?
- [ ] **STF-IBR-061-C**: same question for Excel Foods / DNS Agro (`STF-IBR-061` already linked).

---

## 2. Techno Fab order & payment tracker (Excel)

Details: [sales-tracker-stf-data-issues.md](sales-tracker-stf-data-issues.md).

- [ ] **Duplicate Order ID `STF-IBR-066`** (SHRI GANESH RICE MILLS, two rows). The second is stored as `STF-IBR-066 (2)`. The sheet shows ₹12,00,000 received on it, but no payment row points at it.
- [ ] **`STF NIBR-002`** (TOUHID ENTERPRISES): payments total ₹39,67,265 but the order has no value. Add the order value.
- [ ] **2 payments with no Order ID** (₹4,04,630) and **2 payment rows with no amount**. Not imported; say which order they belong to.
- [ ] **Orders with no date**: `STF-IBR-034/35 C`, `STF-IBR-046`, `STF-IBR-067`. Also 6 payments with no received date.
- [ ] **61 Techno Fab orders not linked to a customer**. Link each from the order once the customer is confirmed.

---

## 3. Shanti Boilers order & payment tracker (Excel)

Row numbers and full tables: [sales-tracker-data-issues.md](sales-tracker-data-issues.md) (sections A and B).

- [ ] **A1**: 2 payments whose order isn't in the sheet (not imported): SB-1008 ₹16,10,950.77, SB-1054 A/B ₹1,00,300.
- [ ] **A2**: 16 payments with no Order ID (₹3,63,254.60), not imported.
- [ ] **A3**: 29 payment rows with no amount, not imported.
- [ ] **A4**: 50 payments with no date (imported with a blank date).
- [ ] **A5**: dates that look like typos (3 orders dated Oct/Nov 2026, 4 payments dated 2055).
- [ ] **A6**: 38 orders with no order date.
- [ ] **A7**: duplicate Order IDs: DN20, DN 16, SAS-322 (the second copy was stored as "… (2)").
- [ ] **A8**: 33 orders where the sheet's "Payment Received" disagrees with the payment list.
- [ ] **A10**: the PAYMENT sheet header is damaged (A1 + row 2 `#REF!`); 43 orders have no value; order IDs are typed inconsistently ("NIBR - 190" vs "NIBR-190").
- [ ] **Client questions B1, B3–B8**: HKM order shape, banner totals, the "closed" column, blank status, sales-person names, creating customers from the sheet, extra columns. (B2, "which order belongs to SB-1109-01-50", is **done**: the 50 units are now linked to their orders.)
- [ ] **709 Shanti Boilers orders still not linked to a customer** (was 849; names kept as text).
  Link them as customers are confirmed. Full detail table (payments, contact person/mobile, address,
  sales person, linked quotation/enquiry) to work through by hand:
  [orders-without-customer-2026-09-30.xlsx](orders-without-customer-2026-09-30.xlsx) (782 rows —
  both companies together, since the export wasn't split by company).
  - Done (2026-09-29): re-ran the exact same name-matching the original import used, now that the
    8,728-row old-CRM customer import has landed — **137 orders** whose customer now exists but
    didn't when the order import first ran were linked (`scripts/backfill-product-gst-and-relink-customers.mjs`).
    The remaining 709 genuinely have no matching customer at all — real companies never entered as a
    customer, not a matcher problem — still need creating/linking by hand.

**Sales → Payment Tracker → Orders now has a status filter (next to search) and a Delete button per
row** — blocked if the order has a payment, invoice, project, return, or work order linked to it, so
it's safe to try on any genuinely-duplicate or test order.

---

## 4. Customers (from the old CRM)

Details: [legacy-crm-import-issues.md](legacy-crm-import-issues.md). **Sales → Customers now has a
Delete button** (open a customer → Delete, top of the sheet) — it refuses if the customer has any
project/order/quotation/invoice/price-list entry, so it's safe to try on anything in this section.

- [ ] **1,315 possible duplicate customers**: same name, but different code or a single-word name, so not merged. List, now with each one's orders/payments/products attached so you can tell them apart without opening the app: [possible-duplicate-customers-2026-09-30.xlsx](possible-duplicate-customers-2026-09-30.xlsx).
- [ ] **604 customers share an exact name** with another organization (e.g. "Anil"). They were kept separate and renamed "Name (code)" / "Name (district)". Rename to the real names where known.
- [x] **Done (2026-09-30)**: `test123`, `TEST44`, `Consultant Test`, `test123 (2)`, and the two
  `ZZ-E2E…` rows from §7 — 7 customers total, all with zero orders/quotations/projects/notes — were
  deleted (backup: `scripts/data/deleted-test-records-2026-09-29.json`).
- [ ] **1 row couldn't be read**: Etico Chemicals P Ltd, in `export_1.csv`. Add it by hand if needed.

---

## 5. Products (from the old CRM)

Details: [legacy-crm-import-issues.md](legacy-crm-import-issues.md) (Products). **Sales → Products
now has a "Missing HSN only" filter** next to the search box — one click shows exactly the 957 rows
below, no need to page through the full list.

- [ ] **24 product codes used by two different products**. The second copy is shown as "CODE (2)". Give each its own code.
- [ ] **34 products with no code**.
- [ ] **126 products with price 0** (imported with no price).
- Done (2026-09-29): **GST %** — every populated GST value anywhere in the system (products and the
  Item Master, 3,600+ rows) was 18%, zero exceptions, so the 983 blank rows were filled with 18%
  by default (`scripts/backfill-product-gst-and-relink-customers.mjs`). If any of these products are
  genuinely GST-exempt, correct them by hand — nothing here can tell exempt from "never entered".
- Done (2026-09-29): **HSN code** — 77 of 1,034 missing-HSN products were filled where every sibling
  product with the same name (ignoring size/dimension) already agreed on one HSN code
  (`scripts/backfill-hsn-from-sibling-family.mjs`, e.g. "AIR LOCK-RAV-100/125/150" → 84029000).
  **957 still have no HSN** — no sibling evidence exists to infer from; these need a real answer from
  whoever classifies the catalog, not a guess.

---

## 6. Enquiries — ownership (all enquiries, not just the old-CRM import)

**This is the single biggest open data-quality gap** — it's why Agent Performance, Employee
Performance 360, and the Prospect Summary report are effectively empty (§9). Real scope, checked
2026-09-30: **2,496 of 3,079 total enquiries (open ones only, not counting closed sales calls) have
no A/C Manager at all** — not just the 598 from the old-CRM sales-call list in §6a below, but most
of the whole enquiry base, including ones created directly in the app.

**New tool for this**: Sales → Enquiry, table view — tick the checkboxes on several rows (or the
header checkbox for all shown), pick a name in the "Assign A/C Manager…" bar that appears, click
Assign. A "No A/C Manager (2,496)" quick filter narrows the list to exactly these rows first. The
enquiry detail sheet's A/C Manager field is also now a live dropdown (was read-only before), for
one-at-a-time fixes, and has a Delete button (blocked if the enquiry has a quotation/order/task, or
is already converted to a customer).

- [ ] **Assign a real A/C Manager to the 2,496 unassigned open enquiries**, using the bulk-assign bar
  above, or work through the full list offline first:
  [unassigned-enquiries-2026-09-30.xlsx](unassigned-enquiries-2026-09-30.xlsx). This alone is what
  would make Agent Performance / Employee Performance 360 / Prospect Summary start showing real
  numbers instead of empty tables.
- [ ] **139 enquiries not linked to a customer**: no match, several matches, or only a similar name. The list with suggestions is [enquiry-import-review.csv](enquiry-import-review.csv). Link each from the enquiry (Convert to customer).
- [ ] **The 598 old-CRM sales-call-list enquiries specifically are all at "Lead - Cold" with no value** (see §6a) — the 15 still-open ones (last 12 months) need a real stage and expected value too, not just an owner.
- [ ] **Product names were cut off** by the PDF (e.g. "BOILER SPA"). Correct them on the open enquiries.

---

## 6a. Diary follow-ups (from the old CRM's Quick Planner export)

Details: [diary-import-notes.md](diary-import-notes.md).

- [ ] **214 organizations not linked to a customer**: no match, several matches, or only a similar
  name. The list is [diary-import-review.csv](diary-import-review.csv) (kind = `no_customer_match`)
  — link them from the customer, then re-run a small follow-up import if the note is still wanted.
- [ ] **214 organizations have a scheduled follow-up but no note was ever logged for them** —
  genuinely never contacted, or the CRM's status was never typed up. Same review CSV (kind =
  `no_history_ever_logged`). Worth a look to see who's actually gone cold.
- [ ] **186 contacts seeded from the Contact Person cell** are best-effort — the raw data was noisy
  (salesperson codes, placeholder text). A few may still be wrong (a company name instead of a
  person, for example). Spot-check the newest customers if this matters.

---

## 6b. Quotation register (from the old CRM)

Details: [quotation-import-notes.md](quotation-import-notes.md).

**Sales → Quotations now has real search (quotation no./customer), a status filter, pagination, and
a Delete button** (per row — blocked if a Sale Order or Sales Invoice was ever raised from it; use
Revise instead of Delete on anything already sent/accepted, since that's a real customer-facing
document).

- [ ] **303 quotation numbers not linked to a customer** — no match, several matches, or only a
  similar name — not imported. [quotation-import-review.csv](quotation-import-review.csv)
  (kind = `no_customer_match`); link them from the customer, then re-import if wanted.
- [ ] **49 rows (21 quotation numbers) are the same number used by two different customers** — a
  real data error in the source register, not imported either way (same review CSV, kind =
  `excluded_same_quotation_number_used_by_a_different_customer`). Worth asking whoever kept the
  register which customer each one actually belongs to, then correcting by hand.
- **129 rows had no quotation number at all** and 21 were obvious test/junk customer rows —
  correctly never imported, nothing to fix (informational, not an action item).
- Done (2026-09-30): **real products, prices and totals for 2,057 of the 2,221 imported
  quotations** — extracted directly from the live SalesMantra CRM (2,728 "Open" + all 5
  "Sent to Customer" quotations, 7,260+ line items) and backfilled by matching on quotation number +
  date. Cleaner review file, split into exactly two sheets (unmatched-at-import vs. genuinely
  ambiguous), each with a "looks like test data" flag where it applies:
  [quotation-review-2026-09-30.xlsx](quotation-review-2026-09-30.xlsx).
  What's still missing:
  - [ ] **164 of the 2,221 headers still have no line items** (checked directly against the database
    on 2026-09-30 — this replaces the earlier "161" estimate, which came from the extraction
    script's own row-level counts, not a direct count of empty headers). The two reasons behind it:
    quotation numbers whose customer couldn't be matched at import (so no header ever existed to
    backfill — the same 303 rows as above), and the 67 genuinely-ambiguous duplicate-number-and-date
    cases in the register (real headers, but the source can't tell which of 2+ rows is which).
  - [x] **Done (2026-09-30)**: the 4 real "Sent to Customer" quotations (of the 5 in that status —
    the 5th, "M/S Nitesh Intreprises", has a blank quotation number in the source and was never
    imported as a header, so there's nothing to attach its data to) now have their real
    products/prices/totals (₹4.72L / ₹33.39L / ₹86.73L / ₹11.62L).
  - [ ] **GST is stored as one net `tax_amount` (total − subtotal), never split into CGST/SGST/
    IGST** — this app has no reliable state-code history for these old customers, so a real split
    would be a guess. Several real quotations show GST as a *subtraction* from the subtotal
    (verified against the live CRM pages, not a scraping bug) rather than an addition — worth
    asking whoever kept these quotes what that actually represents before trusting the numbers for
    tax purposes. There's no in-app fix for this today by design (the app never silently rewrites a
    committed financial figure) — the one real path is the existing **Revise** button on a
    quotation, which reopens it with real per-line GST entry and saves the correction as a new,
    separate revision, leaving the original untouched for audit.
  - [ ] **Reports still show ₹0 quotation activity for almost all of this — see §9.**

---

## 7. Leftover test data (ours)

- [ ] **Project `SB-1057`** ("TEST-STORES-DEMO (safe to ignore) Customer"). Delete via Projects → Delete Project.
- [ ] **Project `TEST-PROJ`** (customer 3F INDUSTRIES LIMITED). Real, or a test? Delete if it's a test.
- [x] **Done (2026-09-30)**: `ZZ-E2E-DELETE-ME Customer` and `ZZ-E2E2-DELETE-ME Customer` deleted
  (they had zero orders/quotations/projects — see §4).
- Done: project `SB-1058` is already gone.
- Done (2026-09-26): the 2 test quotations QTN-27 / QTN-28 on those ZZ customers were deleted (backup in `scripts/data/deleted-test-quotations-2026-09-26.json`).

---

## 8. Data still to bring over from the current CRM

| Data | Now in Shanti Ops | What's needed | How it will be loaded |
|---|---|---|---|
| **Diary / follow-up history** | **Done (2026-09-28)** — 1,939 notes + 186 contacts imported from the old CRM's Quick Planner export, linked to customers (not enquiries — see §6a) | — | — |
| **Contact persons** | 0 (customers have one phone/email only) | Contact list per customer (name, designation, phone, email) | Import into `contacts`, matched to customers by code/name |
| **Past quotations** | **Done (2026-09-28)** — 2,221 header-only quotations imported from the old CRM's register (2,217 draft, 4 sent), linked to customers. No line items exist in the source, so no product/price data came with them — see §6b | — | — |
| **Enquiry stage, A/C manager, value** | All 598 at Lead - Cold, unassigned, no value | Export with stage + owner + value (the PDF didn't have them) | Update the imported enquiries by serial number |
| **Full product names on enquiries** | Cut off by the PDF | Same export as above (text, not PDF) | Same update |
| **Branches** | 0 | Branch list | Masters → Branches (by hand) or a small import |
| **Sales targets** | 0 | Targets per person per month | Masters → Targets |
| **Price lists** | 0 | Customer / default prices per product | Sales → Price Lists, or an import |
| **Sales logins** | **Done** — 17 real logins now exist (Sales Head, Marketing Head, Amit B, Devansh Trivedi, Srivaari, Sales Desk / Sales Desk2, Sales1/2, BDM-Hyderabad/Siliguri/AP-TS/NE/Kolkata/UP, plus kalyani/market/kalyani legacy) | Nothing further required to start using the system; add any name still missing from the real team roster | Settings → User Management |
| **Per salesperson** | 0 targets, 0 branches; **2,496 of 3,079 open enquiries have no A/C Manager** (§6 — checked 2026-09-30, corrects the earlier "only 2 of 3,079" estimate) | Monthly targets per person, branch per person/enquiry, and someone to actually assign each open enquiry to a real login | Masters → Targets / Branches; **now doable in bulk** — Sales → Enquiry → select rows → Assign A/C Manager (§6) |
| **Invoices, receipts, credit notes** | 0 invoices (payments are in the Payment Tracker only) | Decide whether past invoices come from the old CRM/Tally, or start fresh from today | Import or new invoices only |
| **Enquiry → quotation → order links** | Imported orders and enquiries aren't linked to each other | Old-CRM export that carries the enquiry/quotation number on each order | Update by number |
| **Product → BOM template** | 0 products linked | Final Structure Templates first | **Deferred**. See below. |

---

## 9. Reports — checked live against the running app (2026-09-30)

Full write-up: [sales-data-health-2026-09-30.md](sales-data-health-2026-09-30.md).

- [x] **Fixed**: 2,481 imported enquiries had `created_by` set to the raw import-tag text instead of
  blank, so Employee Performance 360 showed a fake "person" named
  `import:sales-projection-enquiries-2026-09-29` with 63 enquiries under it. Corrected directly
  (`created_by` cleared to NULL on all 2,481 rows; the separate `import_tag` column — used for
  rollback — was left untouched). Confirmed live: the fake row is gone, those enquiries now count
  as Unassigned like every other unowned one.
- [x] **Fixed (2026-09-30)**: Diary activity per week, Customer Follow-up, SalesCall/Employee
  Follow-up, and Feedback reports were all reading from a function (`getDiaryNotes()`) that only
  `JOIN`ed enquiries — but every real diary note is attached to a *customer*, not an enquiry, so
  these reports were silently reading zero rows regardless of how much diary data actually existed.
  Changed to a `LEFT JOIN` on both, so a customer-only note is no longer invisible. This does **not**
  fix Feedback specifically — no note has ever been logged as `note_type='feedback'`, so that one
  stays empty until someone starts logging feedback that way (a workflow question, not a bug).
- [x] **Fixed (2026-09-30)**: Agent Performance was grouping enquiries only by `assigned_to`, never
  falling back to `account_manager` like every other report already does — so even after §6's
  ownership is assigned, this report would have kept under-counting. Now uses the same
  A/C-Manager-then-assignee-then-creator chain as everywhere else.
- [ ] **Real decision needed**: Employee Performance 360 and Sales Overview both only count
  quotations whose `status` isn't `'draft'` — and 2,217 of the 2,221 imported quotations are
  `'draft'` (only 4 are `'sent'`, all pre-2025 and $0 — see §6b). Every KPI on both reports
  ("Quotations sent", "Quote value", "Quotations sent per month") reads **0** for essentially the
  entire imported history, even though the real ₹395 crore total is genuinely in the database and
  **does** show correctly on the plain **Quotation Listing** report and inside each quotation's own
  detail page/PDF. This isn't a bug — the import deliberately called "Open" status `draft` rather
  than `sent`, since the source never distinguished "drafted, not sent" from "quoted, awaiting
  reply." Worth deciding: should a historical "Open" quotation actually count as `sent` for
  reporting purposes? If yes, a one-line status update (`UPDATE quotations SET status='sent' WHERE
  import_tag='import:quotation-register-2026-09-28' AND status='draft'`) fixes every report at
  once — not done here since it changes what "draft" means for 2,217 real records.
- [x] Confirmed working with real numbers: Order Book & Collections, Sales Call Funnel, Sales
  Register (correctly empty — 0 invoices exist, see §8), Quotation Listing.

**Will fixing the data above make every report populate properly? Mostly yes, with two real
exceptions worth knowing about before assuming "done" means "every report is now full":**

1. **Reports backed by data that genuinely doesn't exist yet** (§8's 0-row rows — invoices, price
   lists, targets, branches, feedback-type notes, expense claims) will stay empty no matter how
   clean the rest of the data gets. That's not a bug to fix; it's a workflow nobody has started
   using yet. Once real rows exist there, the reports that read them already work correctly.
2. **The draft-vs-sent decision above** is the one report gap that's a business call, not a data-
   cleanliness problem — assigning owners and merging duplicates won't move Employee Performance 360
   or Sales Overview's quotation numbers off ₹0; only that one decision (and the one-line `UPDATE`
   it implies) will.

Everything else genuinely was blocked by dirty/missing data, not by a separate bug — assigning
owners (§6), linking customers (§3/§4/§6a/§6b), and merging duplicates (§4) really will make Agent
Performance, Employee Performance 360's enquiry/sales-call counts, Prospect Summary, and the
Customize Sales Call List's A/C Manager/Branch columns show real numbers once that work is done —
those were checked and confirmed to be pure data gaps, not code gaps, before this was written.

---

## Deferred: BOM template from the Sale Order

When a project is created from a Sale Order, the system can build the project's BOM tree from the
products' Structure Templates. The link (Masters → Products → "BOM structure template") exists but
is unused on purpose: the templates aren't final yet, because each BOM still has unallocated items.
Once the templates are final: link each product to its template, then add the "offer to assign
the BOM template" step at project creation.
