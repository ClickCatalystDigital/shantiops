// One-off loader for the client's real Item Master (Purchase) workbook into the `items` table —
// STORES-SALES-CHANGES.md §3.2 prep. Reuses the exact parser + full-replace semantics
// app/api/masters/[type]/import/route.js already has for this (client-confirmed 2026-08-04: a
// master re-import is always a full replace, not an upsert), just run from a script instead of
// through the UI since no UI trigger exists yet.
//
// Run: node --env-file=.env.local scripts/import-item-master.mjs "/path/to/workbook.xlsx"
import { createClient } from '@libsql/client';
import { readFileSync } from 'node:fs';
import { parseItemMaster } from '../lib/master-import.mjs';

const filePath = process.argv[2];
if (!filePath) {
  console.error('Usage: node --env-file=.env.local scripts/import-item-master.mjs "/path/to/workbook.xlsx"');
  process.exit(1);
}

const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });

const COLUMNS = ['category', 'group_name', 'main_group', 'sub_group', 'group_code', 'item_code',
  'item_name', 'detail_desc', 'drg_no', 'drg_rev', 'part_no', 'uom', 'cqty', 'cfactor',
  'conv_uom', 'material_process_type', 'item_type', 'min_qty', 'max_qty', 'lead_time',
  'tolerance_plus', 'tolerance_minus', 'class', 'store_location', 'bin_no', 'hsn_code',
  'hsn_desc', 'hsn_item_pct'];

const buffer = readFileSync(filePath);
const parsed = parseItemMaster(buffer);
if (parsed.error) { console.error('Parse error:', parsed.error); process.exit(1); }
if (!parsed.records.length) { console.error('No rows found in this workbook.'); process.exit(1); }

console.log(`Parsed ${parsed.records.length} row(s) from sheet "${parsed.sheetName}" (${parsed.skipped} skipped).`);

const existing = await db.execute('SELECT COUNT(*) AS n FROM items');
console.log(`Existing items rows: ${existing.rows[0].n} (will be replaced).`);

await db.execute('DELETE FROM items');
const placeholders = COLUMNS.map(() => '?').join(', ');
let n = 0;
for (const rec of parsed.records) {
  await db.execute({
    sql: `INSERT INTO items (${COLUMNS.join(', ')}) VALUES (${placeholders})`,
    args: COLUMNS.map(c => rec[c] ?? null),
  });
  n++;
}
console.log(`Inserted ${n} item(s) into items.`);
