// scripts/test-certificate-guard-selfcheck.mjs — asserts lib/test-certificate-guard.js's
// TEST_CERTIFICATE_BLOCKING_TABLES still covers every real FK the live schema has into
// test_certificates(id). Same precedent as scripts/bom-item-guard-selfcheck.mjs — this check is
// what stops the next new test_certificate_id-referencing table from silently reintroducing the
// raw-SQL-error bug this guard was built to fix.
//
//   node --env-file=.env.local scripts/test-certificate-guard-selfcheck.mjs
import assert from 'node:assert/strict';
import { createClient } from '@libsql/client';

const GUARDED_TABLES = [
  'qc_document_parts', 'bom_items', 'qc_mountings', 'stock_pieces', 'job_cards',
  'inventory_batches', 'inventory_serials', 'bom_item_receipts', 'bom_item_child_certificates',
];
// Excluded on purpose — the one CASCADE case, a pure association table with no data of its own
// worth blocking a delete over (see lib/test-certificate-guard.js's own header comment).
const DELIBERATELY_UNGUARDED = ['certificate_projects'];

const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });

const tables = await db.execute(
  "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
);

const realFkTables = new Set();
for (const { name: table } of tables.rows) {
  if (table === 'test_certificates') continue;
  const fks = await db.execute(`PRAGMA foreign_key_list(${table})`);
  for (const fk of fks.rows) {
    if (fk.table === 'test_certificates') realFkTables.add(table);
  }
}

const guardedTables = new Set(GUARDED_TABLES);
const missing = [...realFkTables].filter(t => !guardedTables.has(t) && !DELIBERATELY_UNGUARDED.includes(t));
assert.equal(missing.length, 0,
  `New table(s) with a real FK into test_certificates are not in lib/test-certificate-guard.js's ` +
  `TEST_CERTIFICATE_BLOCKING_TABLES (and this script's own mirrored list): ${missing.join(', ')}.`);

console.log(`test-certificate-guard-selfcheck: ${realFkTables.size} real FK table(s) into test_certificates, all accounted for.`);
console.log('PASS');
process.exit(0);
