# sales_call_details1–3.csv — import notes (2026-09-30)

Source: the old CRM's "Sales Projection Enquiry List" (3 files, 5,125 rows). Script: `scripts/import-sales-call-details.mjs`, parser `lib/sales-call-details-import.mjs`.

- 5,124 rows read (1 cut off, listed in the review file), 45 exact repeats ignored.
- **3,036 existing enquiries enriched** (matched by full customer name + enquiry date), fill-blank only: A/C manager (also assigned to / initiated by) on all, phone on 2,259, State on 460, stage corrected on 82 (only where the enquiry's history was import-only), 7 linked to a customer.
- **1,996 missing enquiries added** with the file's stage, A/C manager, value and products; 635 of them older than 12 months at an open stage are closed as historical sales calls; 1,574 linked to a customer on an exact name.
- **2,759 Diary notes** (Action Taken / Plan Of Action) on the enquiries, next follow-up dates exactly as given (1,642 already past).
- Customers: 3,410 filled with a blank email/phone (customers with an email: 293 -> 2,899). 61 contacts added from "Last Contact Name".
- Phones are stored as digits (91-/0 prefix removed). The 3 cells with two emails keep the first.
- Now 5,074 enquiries; 5,033 have an A/C manager (members see only their own).
- Rollback: `node --env-file=.env.local scripts/import-sales-call-details.mjs --rollback` (uses `scripts/data/sales-call-details-manifest.json`, kept locally; a full-size trial rollback returned the tables to an identical state before the real apply).
