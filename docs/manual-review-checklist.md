# Manual review checklist — Sales data (2026-09-25)

Everything a person still has to check or decide after the imports. Tick an item when it's done.
Details and full lists are in the linked files; this page is only the to-do list.

Counts were checked against the live database on 2026-09-25.

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
- [ ] **849 Shanti Boilers orders not linked to a customer** (names kept as text). Link them as customers are confirmed.

---

## 4. Customers (from the old CRM)

Details: [legacy-crm-import-issues.md](legacy-crm-import-issues.md).

- [ ] **1,315 possible duplicate customers**: same name, but different code or a single-word name, so not merged. List: [legacy-crm-possible-duplicates.csv](legacy-crm-possible-duplicates.csv).
- [ ] **604 customers share an exact name** with another organization (e.g. "Anil"). They were kept separate and renamed "Name (code)" / "Name (district)". Rename to the real names where known.
- [ ] **Test-looking customers the old CRM had**: `test123`, `TEST44`, `Consultant Test`. Delete them if they're not real.
- [ ] **1 row couldn't be read**: Etico Chemicals P Ltd, in `export_1.csv`. Add it by hand if needed.

---

## 5. Products (from the old CRM)

Details: [legacy-crm-import-issues.md](legacy-crm-import-issues.md) (Products).

- [ ] **24 product codes used by two different products**. The second copy is shown as "CODE (2)". Give each its own code.
- [ ] **34 products with no code**.
- [ ] **126 products with price 0** (imported with no price).
- [ ] **983 products with GST 0%** (imported with GST blank). Confirm which are really exempt; the rest need their GST %.

---

## 6. Enquiries (from the old CRM sales-call list)

Details: [enquiry-import-notes.md](enquiry-import-notes.md).

- [ ] **139 enquiries not linked to a customer**: no match, several matches, or only a similar name. The list with suggestions is [enquiry-import-review.csv](enquiry-import-review.csv). Link each from the enquiry (Convert to customer).
- [ ] **All 598 enquiries are at "Lead - Cold", unassigned, with no value.** The 15 open ones (last 12 months) need a stage, an A/C manager and an expected value. Until then only the Sales Head sees them.
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

- [ ] **303 quotation numbers not linked to a customer** — no match, several matches, or only a
  similar name — not imported. [quotation-import-review.csv](quotation-import-review.csv)
  (kind = `no_customer_match`); link them from the customer, then re-import if wanted.
- [ ] **49 rows (21 quotation numbers) are the same number used by two different customers** — a
  real data error in the source register, not imported either way (same review CSV, kind =
  `excluded_same_quotation_number_used_by_a_different_customer`). Worth asking whoever kept the
  register which customer each one actually belongs to, then correcting by hand.
- [ ] **129 rows had no quotation number at all** and 21 were obvious test rows — neither imported
  (same review CSV, `excluded_no_quotation_number`/`excluded_test_junk_customer_name`).
- [ ] **No products, price, or line items exist for any of the 2,221 imported quotations** — they're
  real header records (customer, number, date, status) only. If the old CRM (or Tally) has the
  actual quote line items anywhere, that's a separate, bigger import.

---

## 7. Leftover test data (ours)

- [ ] **Project `SB-1057`** ("TEST-STORES-DEMO (safe to ignore) Customer"). Delete via Projects → Delete Project.
- [ ] **Project `TEST-PROJ`** (customer 3F INDUSTRIES LIMITED). Real, or a test? Delete if it's a test.
- [ ] **Customers `ZZ-E2E-DELETE-ME Customer` and `ZZ-E2E2-DELETE-ME Customer`**. Safe to delete: no project or order uses them.
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
| **Sales logins** | 3 Sales users (Sales Head, kalyani, kalyani_sales) | A login for each real salesperson: Amit B, Devansh B, BDM, Sales Desk, Santosh Reddy, … | Settings → User Management. Their old orders/enquiries then show under their name. |
| **Per salesperson** | 0 targets, 0 branches, no A/C manager on any enquiry, 12 order sales-person names that aren't users | Real logins (above), each enquiry's A/C manager, monthly targets per person, branch per person/enquiry | Settings + Masters → Targets / Branches, and the enquiry export above |
| **Invoices, receipts, credit notes** | 0 invoices (payments are in the Payment Tracker only) | Decide whether past invoices come from the old CRM/Tally, or start fresh from today | Import or new invoices only |
| **Enquiry → quotation → order links** | Imported orders and enquiries aren't linked to each other | Old-CRM export that carries the enquiry/quotation number on each order | Update by number |
| **Product → BOM template** | 0 products linked | Final Structure Templates first | **Deferred**. See below. |

---

## Deferred: BOM template from the Sale Order

When a project is created from a Sale Order, the system can build the project's BOM tree from the
products' Structure Templates. The link (Masters → Products → "BOM structure template") exists but
is unused on purpose: the templates aren't final yet, because each BOM still has unallocated items.
Once the templates are final: link each product to its template, then add the "offer to assign
the BOM template" step at project creation.
