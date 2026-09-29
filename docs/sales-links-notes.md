# Sales data-gap fill — notes (2026-09-30)

Script: `scripts/enrich-sales-links.mjs` (plan → apply → rollback; fill-blank only). Rollback: `node --env-file=.env.local scripts/enrich-sales-links.mjs --rollback` (uses the local manifest in `scripts/data/`).

- Address parsing: pincode on 1,402 enquiries; State on 3,456 (text first, else the pincode's first two digits when they belong to one state); city/district on 2,728. Customers got pincode 1,280, State 2,950, city 3,843.
- Product Type (e.g. SOLID-FLAME, SIB-SF-SERIES) stored on 1,150 enquiries (`leads.product_type`).
- 59 enquiries linked to a customer by a unique email or phone; 15 more are shared by several customers (review list).
- 1,063 quotations linked to their enquiry (customer's only enquiry within the year before the quotation); 226 need a person (several fit).
- 147 orders got their customer from an exact name; 21 orders linked to a won enquiry; 12 ambiguous.
- 2,370 imported follow-ups tagged with an Action Type (call 1,054, message 358, status 298, offer 231, intro 177, email 105, meeting 40); 389 left untagged.
- 391 customer-only notes that repeated an enquiry note (same text, date and next-plan date) were removed; kept in the manifest.
- Not possible from the files: the "Last Visit Date" isn't a separate field in the export (the text only mentions visits), expected value is 0 on most rows, many enquiries have no email/phone at source.
- Review list: [sales-links-review.csv](sales-links-review.csv).
