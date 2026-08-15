// lib/pmb-selfcheck.mjs — runnable check for the PMB parser (repo has no JS test framework;
// mirrors the agent's --selftest precedent).
//   node lib/pmb-selfcheck.mjs                         → synthetic-fixture assertions
//   node lib/pmb-selfcheck.mjs <file.xlsx> [...more]   → parse real workbook(s), print summary
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
import { parsePmb } from './pmb.mjs';
import { BOM_FIELDS, editableBomFields, BOM_FIELD_OWNERS, bomStageCounts } from './bom-fields.mjs';

function book(sheetsAoa) {
  const wb = XLSX.utils.book_new();
  for (const [name, aoa] of Object.entries(sheetsAoa)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name);
  }
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

function selfcheck() {
  // Layout A: title row, single header row, STATUS first. Includes an assembly-heading row
  // (has Sl.No + status but no material columns) and a junk row with no description.
  const layoutA = [
    ['SB-9999-M/s TEST-Project Master BOM'],
    ['STATUS \n(PURCHASE)', 'Sl.\nNo.', 'Part Description \n(by DESIGNS)', 'Material Specification\n(by DESIGNS)', 'Size in mm\n(by DESIGNS)', 'MAKE \n(NAME OF THE SUPPLIER)', 'QTY. \n(Nos.)', 'PR No.\n& Date', 'PO No. \n& Date \n(by PURCHASE)', 'GRN No. \n& Date\n(by STORES)', 'GRN\nReceived QTY.\n(by STORES)', 'PENDING\nQTY.\n(by STORES)', 'BQ-TC \nReceived\n& Date\n(by STORES)'],
    ['PENDING', '1', 'BOILER-500 KG/HR @W.P: 10.54', '', '', '', '', '', '', '', '', '', ''],
    ['closed', '2', 'BQ PLATE MATERIAL', 'SA 516 Gr.70', '2000 X 5000 X 8 THK.', '', '1 No', '', 'PO-374 13.03.26', 'GRN-12', '1', '0', ''],
    ['', '', '', 'stray value with no description', '', '', '', '', '', '', '', '', ''],
    ['PENDING', '3', 'MS FLAT', 'MS', 'IS 50 X 5 THK', '', '2 Nos', '', '', '', '', '', ''],
  ];
  // Layout C: title, department band row, then the real columns with split "PO No. | Date" pairs
  // and Production's Issued/Received. STATUS last.
  const layoutC = [
    ['SB-9999-M/s TEST'],
    ['', '', '', '', '', '', '', 'PURCHASE DEPT.', '', 'STORES DEPT.', '', '', '', 'PRODUCTION DEPT.', '', ''],
    ['Sl.\nNo.', 'Part Description', 'Material Specification', 'Size in mm', 'MAKE', 'QTY. \n(Nos.)', 'PR No.\n& Date', 'PO No.', 'Date', 'GRN No.', 'Date', 'Issued', 'Date', 'Received', 'Date', 'STATUS'],
    ['1', 'CHIMNEY', 'MILD STEEL', 'DIA 300NB x 5.2 THK', '', '6 Mtrs', '', '881', '10.06.26', 'G-77', '12.06.26', '5', '13.06.26', '5', '14.06.26', 'received'],
  ];
  const parsed = parsePmb(book({ BOILER: layoutA, CHIMNEY: layoutC }));

  const [a, c] = parsed.sheets;
  assert.equal(a.headerRow, 2, 'layout A header found on row 2');
  assert.equal(a.items.length, 2, 'layout A: heading row and junk row are not items');
  assert.equal(a.items[0].group_label, 'BOILER-500 KG/HR @W.P: 10.54', 'heading became group_label');
  assert.equal(a.items[0].purchase_status, 'Received', 'status word mapped onto the new D4 enum');
  assert.equal(a.items[0].grn_qty_text, '1', 'GRN qty mapped (not swallowed by qty)');
  assert.equal(a.items[0].pending_qty_text, '0', 'pending qty mapped');
  assert.equal(a.items[1].qty_text, '2 Nos', 'qty preserved verbatim');
  assert.equal(a.skipped.length, 1, 'junk row surfaced as skipped');
  assert.equal(a.skipped[0].reason, 'no description');

  assert.equal(c.headerRow, 3, 'layout C: band row skipped, real header on row 3');
  assert.equal(c.items.length, 1);
  const it = c.items[0];
  assert.equal(it.po_ref, '881 10.06.26', 'split "PO No. | Date" joined');
  assert.equal(it.grn_ref, 'G-77 12.06.26', 'split "GRN No. | Date" joined');
  assert.equal(it.issued_ref, '5 13.06.26', 'Production issued + date joined');
  assert.equal(it.received_ref, '5 14.06.26', 'Production received + date joined');
  assert.equal(it.purchase_status, 'Received', 'status mapped from LAST column, onto the new D4 enum');
  assert.equal(it.section, 'CHIMNEY');

  // Field ownership
  assert.deepEqual(editableBomFields({ role: 'admin', departments: [] }), BOM_FIELDS, 'PM edits everything');
  assert.deepEqual(editableBomFields({ role: 'operator', departments: ['Stores'] }), BOM_FIELD_OWNERS.Stores);
  assert.deepEqual(editableBomFields({ role: 'operator', departments: [] }), [], 'unassigned head edits nothing');

  // § Phase 5.0b — bomStageCounts bucketing (shared by BomStageBar's two placements). Mixed
  // array incl. a null and an unrecognized legacy value, both of which must fold into Enquiry.
  const stageCounts = bomStageCounts([
    { purchase_status: 'Enquiry' }, { purchase_status: 'Enquiry' },
    { purchase_status: 'Comparison' },
    { purchase_status: 'Transit' },
    { purchase_status: 'Received' }, { purchase_status: 'Received' }, { purchase_status: 'Received' },
    { purchase_status: 'Cancelled' },
    { purchase_status: null },        // unset -> Enquiry
    { purchase_status: 'PENDING' },   // stale pre-D4 token -> Enquiry
  ]);
  assert.deepEqual(stageCounts, {
    Enquiry: 4, Comparison: 1, Ordered: 0, Transit: 1, Received: 3, Cancelled: 1, 'In-Stock': 0,
  }, 'bomStageCounts: null and unrecognized values fold into Enquiry, every other status counted exactly');

  // Stage summaries must promote observable procurement work even when the editable status cell
  // has not been updated yet, while preserving an explicit Comparison value with no extra signal.
  const derivedCounts = bomStageCounts([
    { purchase_status: 'Enquiry', quote_count: 2 },
    { purchase_status: 'Enquiry', selected_quote_id: 7 },
    { purchase_status: 'Comparison' },
    { purchase_status: 'Ordered' },
  ]);
  assert.equal(derivedCounts.Comparison, 2, 'quote activity and explicit Comparison share the Comparison bucket');
  assert.equal(derivedCounts.Ordered, 2, 'selected supplier and explicit Ordered share the Ordered bucket');

  console.log('pmb selfcheck OK');
}

function report(path) {
  const parsed = parsePmb(readFileSync(path));
  console.log(`\n=== ${path}`);
  for (const s of parsed.sheets) {
    if (s.error) { console.log(`  ${s.name}: ERROR ${s.error}`); continue; }
    console.log(`  ${s.name}: ${s.items.length} items (header row ${s.headerRow})`);
    console.log(`    columns: ${Object.keys(s.columns).join(', ')}`);
    if (s.unmappedColumns.length) console.log(`    unmapped: ${s.unmappedColumns.join(' | ')}`);
    const groups = [...new Set(s.items.map(i => i.group_label).filter(Boolean))];
    if (groups.length) console.log(`    groups: ${groups.slice(0, 6).join(' | ')}${groups.length > 6 ? ' …' : ''}`);
    for (const sk of s.skipped.slice(0, 5)) {
      console.log(`    skipped row ${sk.row} (${sk.reason}): ${JSON.stringify(sk.cells).slice(0, 100)}`);
    }
    if (s.skipped.length > 5) console.log(`    …and ${s.skipped.length - 5} more skipped`);
  }
  console.log(`  TOTAL: ${parsed.totalItems} items, ${parsed.totalSkipped} skipped`);
}

const files = process.argv.slice(2);
if (files.length) files.forEach(report);
else selfcheck();
