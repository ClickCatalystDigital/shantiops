// One-off export for the user's manual review — item 2 of the 2026-09-30 punch list.
// Sheet 1: every quotation that never became a real quotations row (customer match failed at
//          header-import time, blank quotation number, or flagged test/junk).
// Sheet 2: quotations that ARE real headers but whose source line items are ambiguous (a reused
//          quotation number + date pattern the backfill couldn't safely pick between).
import fs from 'fs';
import XLSX from 'xlsx';

// Minimal RFC-4180 parser (quoted fields, "" escaped quotes) — matches the backfill scripts' own
// csvCell() writer exactly; no new dependency needed for this.
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const header = rows[0];
  return rows.slice(1).map(r => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}

const importReview = parseCsv(fs.readFileSync('docs/quotation-import-review.csv', 'utf8'));
const lineItemsReview = parseCsv(fs.readFileSync('docs/quotation-line-items-review.csv', 'utf8'));

const sheet1 = importReview.map(r => ({
  'Quotation No.': r['quotation number'],
  'Customer (as written)': r['customer as written'],
  'Quotation Date': r['quotation date'],
  'Reason not imported': r.reason,
  'Looks like test data': r.reason === 'test/junk customer name' ? 'YES' : '',
  'Possible customer matches': r['possible customers (id: name)'],
  'Revisions found under this number': r['rows in this group'],
}));

const ambiguous = lineItemsReview.filter(r => r.kind === 'ambiguous');
const sheet2 = ambiguous.map(r => ({
  'Quotation No.': r['quotation number'],
  Customer: r.customer,
  'Quotation Date': r['quotation date'],
  Subtotal: r.subtotal,
  'Grand Total': r['grand total'],
  'Why ambiguous': r.detail,
}));

const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheet1), 'No customer match (485)');
XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheet2), 'Ambiguous duplicates (67)');
const out = 'docs/quotation-review-2026-09-30.xlsx';
fs.writeFileSync(out, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
console.log(`wrote ${out}: ${sheet1.length} rows in sheet 1, ${sheet2.length} rows in sheet 2`);
