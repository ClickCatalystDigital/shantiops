// lib/master-import-selfcheck.mjs — runnable check for lib/master-import.mjs (repo has no JS test
// framework; mirrors pmb-selfcheck.mjs's precedent).
//   node lib/master-import-selfcheck.mjs                                → synthetic-fixture assertions
//   node lib/master-import-selfcheck.mjs party <file.xlsx>               → parse a real party file, print summary
//   node lib/master-import-selfcheck.mjs item <file.xlsx>                → parse a real item file, print summary
// Prints only counts/columns/samples — no DB writes, safe to run against real business files.
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
import { parsePartyMaster, parseItemMaster } from './master-import.mjs';

function book(sheetsAoa) {
  const wb = XLSX.utils.book_new();
  for (const [name, aoa] of Object.entries(sheetsAoa)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name);
  }
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

function selfcheck() {
  // Synthetic party sheet: legend row, summary row, blank row, header row, two real rows —
  // matches the real STERP shape (header at row 4, 0-indexed row 3).
  const party = [
    ['', '', '', 'Highlight Field Is Must Required'],
    ['', 'Total No. of Party *', 332],
    [],
    ['No', 'Party Code', 'Party Name*', 'Address1', 'Address2', 'Address3', 'City', 'State Code',
      'State', 'Country', 'Pin Code', 'Area', 'Phone No.', 'Fax No.', 'Email ID', 'Web Site',
      'GSTIN No.', 'PAN No.', 'Range', 'Div.', 'GST Trans Type', 'Business Type'],
    [1, 'C001', 'TEST VENDOR PVT LTD', '1 Industrial Area', '', '', 'Hyderabad', 36, 'Telangana',
      'India', 500051, '', '9999999999', '', 'test@vendor.com', '', '36AAACT1234A1Z1', 'AAACT1234A',
      '', '', 'Intrastate', 'Private Limited Company'],
    [2, '', 'ANOTHER VENDOR', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
  ];
  // A second, non-matching reference sheet (like the real vendor file's Sheet1/Sheet2) — must be
  // skipped in favor of the sheet that actually has the party header.
  const p = parsePartyMaster(book({ Sheet1: [['City', 'State Code', 'State', 'Country'], ['Mumbai', 27, 'Maharashtra', 'India']], Vendor: party }));
  assert.equal(p.sheetName, 'Vendor');
  assert.equal(p.records.length, 2);
  assert.equal(p.records[0].name, 'TEST VENDOR PVT LTD');
  assert.equal(p.records[0].state_code, '36');
  assert.equal(p.records[0].gst_no, '36AAACT1234A1Z1');
  assert.equal(p.records[1].name, 'ANOTHER VENDOR');
  assert.equal(p.skipped, 0);

  // Synthetic item sheet: header row, marker row (no Item Name — must be skipped), two real rows.
  const item = [
    ['', 'Catetory', 'Group Name', '', '', '', 'Main Group', 'Sub Group', 'Group Code', '', 'Item Code',
      'Item Name 55 Character Limit', '', 'Detail Desc 4000 Char', 'DrgNo.', 'DrgRev.', 'PartNo./Cat No.',
      'UOM', 'Cqty', 'Cfactor', 'ConvUOM', 'Material Proceess Type', 'Item Type'],
    ['', 'a', 'b', '', '', '', 'Optional', 'Optional', '', 'Temp Field', '', '', '', 'Optional',
      'Optional', 'Optional', 'Optional', 'Store', 'Store', 'Purchase', 'Purchase'],
    ['', 'BOI', 'AD-ON BLOCK', '', '', '', 'MSSH', '00000001', 'ADBL', '0000001', 'ADBL0000001',
      'AD-ON BLOCK 2NO-NC', '', '', '', '', '', 'Nos', 100, 1, 'Nos', 'Procured', 'Purchase'],
    ['', 'BOI', 'AD-ON BLOCK', '', '', '', '', '', 'ADBL', '', '', 'AD ON BLOCK 1NO-NC', '', '', '',
      '', '', 'Nos', 100, 1, 'Nos', 'Procured', 'Purchase'],
  ];
  const it = parseItemMaster(book({ Examples: item }));
  assert.equal(it.sheetName, 'Examples');
  assert.equal(it.records.length, 2); // marker row skipped, both real rows kept (incl. blank item_code on row 2)
  assert.equal(it.records[0].item_code, 'ADBL0000001');
  assert.equal(it.records[1].item_code, null);
  assert.equal(it.records[1].item_name, 'AD ON BLOCK 1NO-NC');
  assert.equal(it.records[0].material_process_type, 'Procured');

  console.log('master-import selfcheck: OK');
}

const [, , mode, file] = process.argv;
if (!mode) {
  selfcheck();
} else if ((mode === 'party' || mode === 'item') && file) {
  const buffer = readFileSync(file);
  const parsed = mode === 'party' ? parsePartyMaster(buffer) : parseItemMaster(buffer);
  console.log(`file: ${file}`);
  console.log(`sheet used: ${parsed.sheetName}${parsed.error ? ` (${parsed.error})` : ''}`);
  console.log(`columns mapped: ${parsed.columns.join(', ')}`);
  console.log(`records: ${parsed.records.length}   skipped (no identity field): ${parsed.skipped}`);
  console.log('sample (first 3):');
  for (const r of parsed.records.slice(0, 3)) console.log('  ', r);
} else {
  console.error('Usage: node lib/master-import-selfcheck.mjs [party|item <file.xlsx>]');
  process.exit(1);
}
