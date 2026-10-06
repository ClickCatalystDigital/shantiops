// scripts/import-inventory-sheet.mjs — replaces the whole Stores inventory with the client's real stock register
// ("_Techno Inventory Management - 25-26 .xlsx"). Everything in inventory before this was test data.
//
// Input: docs/inventory-sheet-match.csv (scripts/match-inventory-sheet.mjs), where every in-stock item is linked to one
// Item Master row. Imported: rows with qty > 0, once each (the sheet repeats a few rows). One stock line per item:
//   description = Item Master name, item_id, on_hand, unit (the unit the sheet counts in; Item Master unit when the sheet
//   has none), reorder_point, category / MOC / dimensions = the Item Master defaults, tracking_mode 'scalar'.
// Costs are NOT imported (the sheet's cost columns are unreliable); avg_cost starts at 0 and the first bill sets it.
//
// Removed (test data): every inventory line, stock piece, batch, serial, reservation, batch allocation and stock movement.
// Links to them in other records are cleared, not deleted (BOM lines, inward reviews, returns, indents, QC parts, NCRs).
// Everything is backed up first; --rollback puts the old inventory back exactly (same ids) and removes the import.
//
//   node --env-file=.env.local scripts/import-inventory-sheet.mjs              dry run
//   node --env-file=.env.local scripts/import-inventory-sheet.mjs --apply
//   node --env-file=.env.local scripts/import-inventory-sheet.mjs --rollback
import { createClient } from '@libsql/client';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const CSV = 'docs/inventory-sheet-match.csv';
const BACKUP = 'scripts/data/inventory-replace-backup.json';
const ACTOR = 'script:inventory-import-2026-10-06';
const apply = process.argv.includes('--apply'), rollback = process.argv.includes('--rollback');
const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });
const all = async (sql, args = []) => (await db.execute({ sql, args })).rows.map(r => ({ ...r }));

// Old inventory, in delete order (children first). Each: table, rows to back up.
const OWNED = [
  ['inventory_batch_allocations', 'SELECT * FROM inventory_batch_allocations'],
  ['inventory_reservations', 'SELECT * FROM inventory_reservations'],
  ['stock_pieces', 'SELECT * FROM stock_pieces'],
  ['inventory_batches', 'SELECT * FROM inventory_batches'],
  ['inventory_serials', 'SELECT * FROM inventory_serials'],
  ['tc_item_match_approvals', 'SELECT * FROM tc_item_match_approvals'],
  ['stock_movements', 'SELECT * FROM stock_movements'],
  ['inventory_items', 'SELECT * FROM inventory_items'],
];
// Links from records that stay: [table, column]
const LINKS = [
  ['bom_items', 'inventory_item_id'], ['inward_approvals', 'inventory_item_id'], ['sales_returns', 'inventory_item_id'],
  ['purchase_returns', 'inventory_item_id'], ['material_indent_items', 'inventory_item_id'], ['material_indent_items', 'stock_piece_id'],
  ['qc_document_parts', 'stock_piece_id'], ['ncr_records', 'stock_piece_id'],
];

const insertSql = (table, row) => {
  const cols = Object.keys(row);
  return { sql: `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, args: cols.map(c => row[c]) };
};

if (rollback) {
  if (!existsSync(BACKUP)) { console.error(`No backup at ${BACKUP}`); process.exit(1); }
  const b = JSON.parse(readFileSync(BACKUP, 'utf8'));
  const used = await all(`SELECT COUNT(*) n FROM inventory_reservations WHERE inventory_item_id IN (${b.imported_ids.join(',') || 0})`);
  const pieces = await all(`SELECT COUNT(*) n FROM stock_pieces WHERE inventory_item_id IN (${b.imported_ids.join(',') || 0})`);
  if (used[0].n || pieces[0].n) { console.error('The imported stock has been used since (reservations or pieces) — not rolling back automatically.'); process.exit(1); }
  const stmts = [
    { sql: `UPDATE bom_items SET inventory_item_id = NULL WHERE inventory_item_id IN (${b.imported_ids.join(',') || 0})`, args: [] },
    { sql: `DELETE FROM stock_movements WHERE inventory_item_id IN (${b.imported_ids.join(',') || 0})`, args: [] },
    { sql: `DELETE FROM inventory_items WHERE id IN (${b.imported_ids.join(',') || 0})`, args: [] },
  ];
  const oldItemIds = b.tables.inventory_items.map(r => r.id).join(',') || 0;
  for (const [table] of [...OWNED].reverse()) {
    // Re-inserting inventory_items fires the stock-movement trigger; drop those rows before restoring the real history.
    if (table === 'stock_movements') stmts.push({ sql: `DELETE FROM stock_movements WHERE inventory_item_id IN (${oldItemIds})`, args: [] });
    for (const row of b.tables[table]) {
      if (table === 'stock_pieces') stmts.push(insertSql(table, { ...row, parent_id: null, root_id: null }));
      else stmts.push(insertSql(table, row));
    }
  }
  for (const p of b.tables.stock_pieces) if (p.parent_id || p.root_id) stmts.push({ sql: 'UPDATE stock_pieces SET parent_id = ?, root_id = ? WHERE id = ?', args: [p.parent_id, p.root_id, p.id] });
  for (const l of b.links) stmts.push({ sql: `UPDATE ${l.table} SET ${l.column} = ? WHERE id = ?`, args: [l.value, l.id] });
  stmts.push({ sql: "UPDATE counters SET value = ? WHERE name = 'inventory_item_code'", args: [b.counter] });
  stmts.push({ sql: 'INSERT INTO usb_audit (request_id, machine_id, actor, action, detail) VALUES (NULL, NULL, ?, ?, ?)', args: [ACTOR, 'inventory_import_rollback', JSON.stringify({ removed: b.imported_ids.length })] });
  await db.batch(stmts, 'write');
  console.log(`Rolled back: removed ${b.imported_ids.length} imported lines, restored the previous inventory.`);
  process.exit(0);
}

// --- read the reviewed match sheet ---
function parseCsv(text) {
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { f += '"'; i++; } else if (c === '"') q = false; else f += c; }
    else if (c === '"') q = true; else if (c === ',') { row.push(f); f = ''; } else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; } else f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  const [head, ...rest] = rows;
  return rest.filter(r => r.length > 1).map(r => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}
const UNIT = { NOS: 'Nos', NO: 'Nos', '.NOS': 'Nos', MTR: 'Mtr', MTRS: 'Mtr', KG: 'Kgs', KGS: 'Kgs', LITRES: 'Ltr', LTRS: 'Ltr', LTR: 'Ltr', PKTS: 'Pkt', PAIR: 'Pair', PAIRS: 'Pair', ROLL: 'Roll' };
const unitOf = u => UNIT[String(u).trim().toUpperCase()] || (String(u).trim() || null);

const sheet = parseCsv(readFileSync(CSV, 'utf8')).filter(r => Number(r.qty_on_hand) > 0 && r.unit_check !== 'duplicate sheet row, count once');
const missing = sheet.filter(r => !r.item_code);
if (missing.length) { console.error(`${missing.length} in-stock rows have no Item Master link — fix the mapping first:`, missing.slice(0, 5).map(r => r.description)); process.exit(1); }
const byCode = new Map((await all('SELECT id, item_code, item_name, uom, bom_category, default_moc, default_category_fields_json FROM items')).map(r => [r.item_code, r]));
const seenItem = new Set();
const lines = sheet.map(r => {
  const it = byCode.get(r.item_code);
  if (!it) throw new Error(`Item Master ${r.item_code} not found (${r.description})`);
  if (seenItem.has(it.id)) throw new Error(`Two sheet rows map to ${r.item_code} — merge or split them first`);
  seenItem.add(it.id);
  return {
    sheet: `${r.sheet_code}|${r.description}`, item: it, on_hand: Number(r.qty_on_hand),
    unit: unitOf(r.sheet_unit) || it.uom || null, unit_from: r.sheet_unit ? 'sheet' : 'Item Master',
    reorder: Number(r.reorder_limit) > 0 ? Number(r.reorder_limit) : null,
  };
});

// --- what goes ---
const counts = {};
for (const [t, sql] of OWNED) counts[t] = (await all(sql.replace('SELECT *', 'SELECT COUNT(*) n')))[0].n;
const linkCounts = {};
for (const [t, c] of LINKS) linkCounts[`${t}.${c}`] = (await all(`SELECT COUNT(*) n FROM ${t} WHERE ${c} IS NOT NULL`))[0].n;
console.log(apply ? '=== APPLYING ===' : '=== DRY RUN (nothing written) ===');
console.log('Removed (test data):', counts);
console.log('Links cleared:', Object.fromEntries(Object.entries(linkCounts).filter(([, n]) => n)));
console.log(`Imported: ${lines.length} stock lines, total units by unit:`,
  lines.reduce((m, l) => (m[l.unit || '?'] = Math.round(((m[l.unit || '?'] || 0) + l.on_hand) * 100) / 100, m), {}));
console.log(`  unit from sheet: ${lines.filter(l => l.unit_from === 'sheet').length}, from Item Master (sheet blank): ${lines.filter(l => l.unit_from !== 'sheet').length}`);
console.log(`  with a reorder limit: ${lines.filter(l => l.reorder).length}`);
if (!apply) process.exit(0);

// --- backup ---
const tables = {};
for (const [t, sql] of OWNED) tables[t] = await all(sql);
const links = [];
for (const [t, c] of LINKS) for (const r of await all(`SELECT id, ${c} AS value FROM ${t} WHERE ${c} IS NOT NULL`)) links.push({ table: t, column: c, id: r.id, value: r.value });
const counter = Number((await all("SELECT value FROM counters WHERE name = 'inventory_item_code'"))[0]?.value || 1000);
const cols = (await all('PRAGMA table_info(inventory_items)')).map(c => c.name);
if (!cols.includes('unit')) await db.execute('ALTER TABLE inventory_items ADD COLUMN unit TEXT');

// --- one transaction: clear links, delete old, insert new ---
const stmts = [];
for (const [t, c] of LINKS) stmts.push({ sql: `UPDATE ${t} SET ${c} = NULL WHERE ${c} IS NOT NULL`, args: [] });
stmts.push({ sql: 'UPDATE stock_pieces SET parent_id = NULL, root_id = NULL', args: [] });
for (const [t] of OWNED) stmts.push({ sql: `DELETE FROM ${t}`, args: [] });
lines.forEach((l, i) => stmts.push({
  sql: `INSERT INTO inventory_items (description, item_id, item_code, on_hand, unit, reorder_point, category, moc, category_fields_json, tracking_mode, track_pieces, avg_cost)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'scalar', 0, 0)`,
  args: [l.item.item_name, l.item.id, `INV-${counter + i + 1}`, l.on_hand, l.unit, l.reorder, l.item.bom_category || null, l.item.default_moc || null, l.item.default_category_fields_json || null],
}));
stmts.push({ sql: "INSERT INTO counters (name, value) VALUES ('inventory_item_code', ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value", args: [counter + lines.length] });
writeFileSync(BACKUP, JSON.stringify({ at: new Date().toISOString(), counter, tables, links, imported_ids: [] }, null, 1));
await db.batch(stmts, 'write');

const imported = await all(`SELECT id, item_code, item_id FROM inventory_items ORDER BY id`);
writeFileSync(BACKUP, JSON.stringify({ at: new Date().toISOString(), counter, tables, links, imported_ids: imported.map(r => r.id),
  imported: imported.map((r, i) => ({ id: r.id, item_code: r.item_code, sheet: lines[i].sheet })) }, null, 1));
await db.execute({ sql: 'INSERT INTO usb_audit (request_id, machine_id, actor, action, detail) VALUES (NULL, NULL, ?, ?, ?)',
  args: [ACTOR, 'inventory_replaced_from_sheet', JSON.stringify({ removed: counts, imported: lines.length, backup: BACKUP })] });
console.log(`Done: ${imported.length} stock lines (INV-${counter + 1} .. INV-${counter + lines.length}). Backup: ${BACKUP}`);
