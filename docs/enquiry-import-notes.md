# Old CRM sales calls — import notes (2026-09-25)

Source: the old CRM's sales call list (PDF, 605 rows) extracted to CSV.

- 605 rows read -> 598 enquiries imported.
- 7 rows were the same enquiry printed twice (same customer, date, products, phone) and were imported once.
- 0 rows could not be read: none.
- Stage: the list has no stage, so every enquiry is at "Lead - Cold". Enquiries dated 2025-09-25 or later (15) are open on the Enquiry tab; the 583 older ones are imported as **closed** sales calls ("Closed by old CRM import") — kept as history on the customer, not as open work.
- No A/C manager or value in the list: enquiries are unassigned (the Sales Head sees them all) and have no expected value.
- Products: 259 enquiries list products. The PDF cut the product names off at the column edge (e.g. "BOILER SPA", "F GAS DUCTI"), so the text is kept exactly as printed, as one product line on the enquiry — it is **not** linked to the Product Master.
- District "ALL" and state "NA" were the old CRM's blanks and are left empty.
- Customers: 459 enquiries were linked to an existing customer (exact name, one match). 418 of those customers had no phone/email and got the one from their latest enquiry.
- 139 enquiries were **not** linked — the name matched no customer, matched several, or only looked similar. They are listed in `docs/enquiry-import-review.csv` with suggestions; link them from the enquiry (Convert to customer) after checking.
- Rollback: `IMPORT_MANIFEST=scripts/data/enquiry-import-manifest.json node scripts/import-enquiries.mjs --rollback`.
