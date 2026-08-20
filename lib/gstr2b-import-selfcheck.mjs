// lib/gstr2b-import-selfcheck.mjs — runnable check for lib/gstr2b-import.mjs, same precedent as
// lib/master-import-selfcheck.mjs.
//   node lib/gstr2b-import-selfcheck.mjs                    → synthetic-fixture assertions
//   node lib/gstr2b-import-selfcheck.mjs <real-file.xlsx>   → parse a real download, print summary
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
import { parseGstr2b } from './gstr2b-import.mjs';

function book(sheetsAoa) {
  const wb = XLSX.utils.book_new();
  for (const [name, aoa] of Object.entries(sheetsAoa)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name);
  }
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

function selfcheck() {
  const b2b = [
    ['GSTR-2B : ITC Statement'],
    ['GSTIN', '36AAECS7382N1ZN', 'Period', 'Jul-2026'],
    [],
    ['GSTIN of supplier', 'Trade/Legal name', 'Invoice number', 'Invoice Date', 'Invoice Value(₹)',
      'Taxable Value (₹)', 'Integrated Tax(₹)', 'Central Tax(₹)', 'State/UT Tax(₹)', 'Cess(₹)',
      'ITC Availability', 'Reason'],
    ['36BBBBB1111B1Z1', 'STEEL SUPPLIER PVT LTD', 'SUP-01', '05-Jul-2026', '11,800.00',
      '10,000.00', '0.00', '900.00', '900.00', '0.00', 'Yes', ''],
    ['36CCCCC2222C1Z1', 'FASTENER TRADERS', 'SUP-02', '12-Jul-2026', '5,900.00',
      '5,000.00', '900.00', '0.00', '0.00', '0.00', 'No', 'Recipient not registered on invoice date'],
    ['Total', '', '', '', '17,700.00', '15,000.00', '900.00', '900.00', '900.00', '0.00', '', ''], // no invoice number -> skipped
  ];
  const p = parseGstr2b(book({ Summary: [['GSTIN', 'Legal Name'], ['36AAECS7382N1ZN', 'Shanti Boilers']], B2B: b2b }));
  assert.equal(p.sheetName, 'B2B');
  assert.equal(p.records.length, 2);
  assert.equal(p.skipped, 1);
  assert.equal(p.records[0].supplier_gstin, '36BBBBB1111B1Z1');
  assert.equal(p.records[0].taxable_value, 10000);
  assert.equal(p.records[0].cgst, 900);
  assert.equal(p.records[0].itc_availability, 'Yes');
  assert.equal(p.records[1].itc_availability, 'No');
  assert.equal(p.records[1].itc_reason, 'Recipient not registered on invoice date');

  // A workbook with no recognizable GSTR-2B sheet at all -> a clear error, not a silent empty parse.
  const bad = parseGstr2b(book({ Sheet1: [['Foo', 'Bar'], [1, 2]] }));
  assert.ok(bad.error);
  assert.equal(bad.records.length, 0);

  console.log('lib/gstr2b-import.mjs selfcheck: all assertions passed');
}

const realFile = process.argv[2];
if (realFile) {
  const result = parseGstr2b(readFileSync(realFile));
  console.log(JSON.stringify({ sheetName: result.sheetName, columns: result.columns, count: result.records.length, skipped: result.skipped, sample: result.records.slice(0, 3), error: result.error }, null, 2));
} else {
  selfcheck();
}
