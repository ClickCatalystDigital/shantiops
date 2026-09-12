// scripts/bom-item-guard-selfcheck.mjs — asserts lib/bom-item-guard.js's BOM_ITEM_BLOCKING_TABLES
// still covers every real FK the live schema actually has into bom_items(id). This list exists
// specifically because the app already hit this exact bug twice, one table at a time, before being
// centralized (see that file's own header comment) — this check is what stops a third recurrence
// the next time a new bom_item_id-referencing table gets added without anyone remembering to update
// the list there too.
//
// Hand-mirrors lib/bom-item-guard.js's own table list rather than importing it — that file imports
// lib/db.js, whose own import graph (lib/milestones.js, etc.) isn't plain-Node-resolvable, same
// reason every other selfcheck in this repo that needs the DB connects to it directly instead
// (see e.g. scripts/seed-bom-templates.mjs). Keep this list in sync with lib/bom-item-guard.js's
// BOM_ITEM_BLOCKING_TABLES whenever that one changes — this check only catches a table the *DB
// schema* has that this list doesn't; it can't catch the two lists drifting apart from each other.
//
//   node --env-file=.env.local scripts/bom-item-guard-selfcheck.mjs
import assert from 'node:assert/strict';
import { createClient } from '@libsql/client';

const GUARDED_TABLES = [
  'packing_items', 'inventory_reservations', 'material_indent_items', 'qc_records',
  'supplier_quotes', 'po_items', 'qc_document_parts', 'rfq_items', 'qc_mountings',
  'material_issues', 'work_order_materials', 'bom_change_notes', 'job_work_inspections',
  'vendor_bill_items', 'ncr_records', 'bom_item_receipts', 'bom_item_child_allocations',
  'bom_item_child_routing', 'bom_item_child_certificates',
];

const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });

const tables = await db.execute(
  "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
);

const realFkTables = new Set();
for (const { name: table } of tables.rows) {
  if (table === 'bom_items') continue;
  const fks = await db.execute(`PRAGMA foreign_key_list(${table})`);
  for (const fk of fks.rows) {
    if (fk.table === 'bom_items') realFkTables.add(table);
  }
}

const guardedTables = new Set(GUARDED_TABLES);

// Every table with a real, enforced FK into bom_items must be in the guard list — a DB-level FK
// with no ON DELETE CASCADE/SET NULL will throw a raw SQLITE_CONSTRAINT error on delete if it's
// missing here (or, for the one CASCADE case, silently destroy real history).
const missing = [...realFkTables].filter(t => !guardedTables.has(t));
assert.equal(missing.length, 0,
  `New table(s) with a real FK into bom_items are not in lib/bom-item-guard.js's ` +
  `BOM_ITEM_BLOCKING_TABLES (and this script's own mirrored list): ${missing.join(', ')}.`);

// The reverse isn't an error (packing_items is deliberately guarded despite having no DB-level FK
// at all — a business rule, not a constraint) — just report it so this stays legible.
const businessRuleOnly = [...guardedTables].filter(t => !realFkTables.has(t));
console.log(`bom-item-guard-selfcheck: ${realFkTables.size} real FK table(s) into bom_items, all covered.`);
if (businessRuleOnly.length) {
  console.log(`(guarded for other reasons, no DB-level FK: ${businessRuleOnly.join(', ')})`);
}
console.log('PASS');
process.exit(0);
