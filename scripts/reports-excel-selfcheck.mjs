// scripts/reports-excel-selfcheck.mjs — node scripts/reports-excel-selfcheck.mjs
// Pure-function checks for lib/reports/excel.js's toWorkbook(). No DB, no fake data written
// anywhere. Proves the one thing that would have shipped silently wrong: right-aligned columns
// must round-trip as real numbers (so Excel's own SUM/sort work), not the fmt()-formatted display
// string as inert text — including the parenthesized-negative case fmt() produces.
import { strict as assert } from 'node:assert';
import * as XLSX from 'xlsx';
import { toWorkbook } from '../lib/reports/excel.js';

function readBack(buf) {
  const wb = XLSX.read(buf, { type: 'buffer' });
  return wb.SheetNames.map((name) => ({
    name,
    rows: XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1 }),
  }));
}

// 1. Single-section table, mixed text + numeric (incl. a raw-number column and a fmt()-string one).
{
  const table = {
    cols: [
      ['Item', 20, (r) => r.item],
      ['Qty', 10, (r) => r.qty, 'right'],
      ['Value', 15, (r) => `Rs. ${r.value.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, 'right'],
    ],
    rows: [
      { item: 'MS Plate 10mm', qty: 25, value: 123456.78 },
      { item: 'MS Angle 50x50', qty: 8, value: 4500 },
    ],
  };
  const sheets = readBack(toWorkbook({ table }));
  assert.equal(sheets.length, 1, 'single-section table should produce exactly one sheet');
  assert.deepEqual(sheets[0].rows[0], ['Item', 'Qty', 'Value'], 'header row must match column labels');
  assert.equal(typeof sheets[0].rows[1][1], 'number', 'raw-number column must stay a number');
  assert.equal(sheets[0].rows[1][1], 25);
  assert.equal(typeof sheets[0].rows[1][2], 'number', 'fmt()-formatted currency column must reparse to a number');
  assert.equal(sheets[0].rows[1][2], 123456.78);
}

// 2. Parenthesized-negative currency (fmt()'s convention for negative balances) must reparse negative.
{
  const table = {
    cols: [
      ['Account', 20, (r) => r.account],
      ['Balance', 15, (r) => `(Rs. 17,700.00)`, 'right'],
    ],
    rows: [{ account: 'Sundry Creditors' }],
  };
  const sheets = readBack(toWorkbook({ table }));
  assert.equal(sheets[0].rows[1][1], -17700, 'parenthesized fmt() negative must reparse as a real negative number');
}

// 3. Multi-section table (GSTR-1's shape) produces one correctly-named sheet per section.
{
  const table = {
    sections: [
      { title: 'B2B Summary (by GSTIN)', cols: [['GSTIN', 18, (g) => g.gstin], ['Taxable', 16, (g) => `Rs. 1,000.00`, 'right']], rows: [{ gstin: '27AAAAA0000A1Z5' }] },
      { title: 'HSN Summary', cols: [['HSN', 12, (h) => h.hsn]], rows: [{ hsn: '7308' }] },
    ],
  };
  const sheets = readBack(toWorkbook({ table }));
  assert.equal(sheets.length, 2, 'section count must match sheet count');
  assert.deepEqual(sheets.map((s) => s.name), ['B2B Summary (by GSTIN)', 'HSN Summary']);
  assert.equal(sheets[0].rows[1][1], 1000, 'section-table numeric column must also reparse');
}

// 4. Sheet name over Excel's 31-char / illegal-character limit must be sanitized, not rejected.
{
  const table = { sections: [{ title: 'A Very Long Section Title That Exceeds Thirty One Characters: yes/no?', cols: [['X', 5, (r) => r.x]], rows: [{ x: 1 }] }] };
  const sheets = readBack(toWorkbook({ table }));
  assert.ok(sheets[0].name.length <= 31, `sheet name must be truncated to 31 chars, got "${sheets[0].name}" (${sheets[0].name.length})`);
  assert.ok(!/[\\/?*[\]:]/.test(sheets[0].name), 'sheet name must not contain Excel-illegal characters');
}

console.log('OK — toWorkbook() produces valid, correctly-typed, correctly-named workbooks.');
