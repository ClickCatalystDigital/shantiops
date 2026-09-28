# Old CRM quotation register — import notes (2026-09-28)

Source: two exports of the old CRM's quotation register — 2728
rows at "Open" status, 5 at "Sent to Customer".
No products, price, or line items exist in either export — every imported row is a header-only
quotation shell (subtotal/tax/total = 0, no quotation_items).

- 2733 rows read.
- 182 excluded outright (never guessed): test/junk customer names, blank quotation
  numbers, or a quotation number reused across two different customers (a real data error in the
  source — kept in `docs/quotation-import-review.csv` since it can't be resolved from the data).
- 2413 distinct quotation numbers remain, covering **2551 rows**.
- 2110 matched exactly one existing customer and were imported as
  **2221 quotations** (86 of those
  are real revision chains — the same number reused by the same customer on different dates — linked
  via parent_quotation_id/revision_no, "<no>-R1", "-R2" ...).
- 303 were **not** linked (name matched no customer, matched several, or only looked
  similar) — not imported. Listed in `docs/quotation-import-review.csv`.
- `company` was set from the quotation number's SB/STF prefix only when unambiguous; left blank
  (defaults to Shanti Boilers in the app) for typo'd/legacy-format numbers.
- Rollback: `node scripts/import-quotations.mjs --rollback`.
