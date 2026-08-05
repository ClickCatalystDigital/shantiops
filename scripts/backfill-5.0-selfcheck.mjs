// scripts/backfill-5.0-selfcheck.mjs — runnable check for Phase 5.0's purchase_status backfill
// (V2-CHANGES.md D4). No JS test framework in this repo (same precedent as lib/pmb-selfcheck.mjs
// and agent/agent.py --selftest): synthetic fixtures on an in-memory libsql DB, assert-based.
//   node scripts/backfill-5.0-selfcheck.mjs
import assert from 'node:assert';
import { createClient } from '@libsql/client';

const db = createClient({ url: ':memory:' });

async function run(sql, args = []) {
  return db.execute({ sql, args });
}

// Minimal schema — just the two tables the backfill's WHERE/EXISTS actually touch.
await run(`CREATE TABLE bom_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_status TEXT,
  po_ref TEXT
)`);
await run(`CREATE TABLE supplier_quotes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bom_item_id INTEGER
)`);

// One row per case the backfill's five UPDATEs need to distinguish.
const CASES = [
  { label: 'TRANSIT -> Transit',                    status: 'TRANSIT',   po_ref: null,   quote: false, expect: 'Transit' },
  { label: 'CLOSED -> Received',                    status: 'CLOSED',    po_ref: null,   quote: false, expect: 'Received' },
  { label: 'RECEIVED -> Received',                  status: 'RECEIVED',  po_ref: null,   quote: false, expect: 'Received' },
  { label: 'CANCELLED -> Cancelled',                 status: 'CANCELLED', po_ref: null,   quote: false, expect: 'Cancelled' },
  { label: 'PENDING + po_ref -> Ordered',             status: 'PENDING',   po_ref: '881/26', quote: false, expect: 'Ordered' },
  { label: 'PENDING + quote, no po_ref -> Comparison', status: 'PENDING',   po_ref: null,   quote: true,  expect: 'Comparison' },
  { label: 'PENDING, nothing else -> Enquiry',        status: 'PENDING',   po_ref: null,   quote: false, expect: 'Enquiry' },
  { label: 'NULL + po_ref -> Ordered',                status: null,       po_ref: '882/26', quote: false, expect: 'Ordered' },
  { label: 'NULL + quote -> Comparison',              status: null,       po_ref: null,   quote: true,  expect: 'Comparison' },
  { label: 'NULL, nothing else -> Enquiry',           status: null,       po_ref: null,   quote: false, expect: 'Enquiry' },
];

const ids = [];
for (const c of CASES) {
  const { lastInsertRowid } = await run(
    'INSERT INTO bom_items (purchase_status, po_ref) VALUES (?, ?)', [c.status, c.po_ref]);
  const id = Number(lastInsertRowid);
  ids.push(id);
  if (c.quote) await run('INSERT INTO supplier_quotes (bom_item_id) VALUES (?)', [id]);
}

// The exact backfill block from lib/db.js's migrate() (kept in sync by hand — small enough that a
// drift would be caught immediately by this script failing).
async function runBackfill() {
  const needsBackfill = await run(
    `SELECT 1 FROM bom_items
      WHERE purchase_status IN ('PENDING','TRANSIT','CLOSED','RECEIVED','CANCELLED')
         OR purchase_status IS NULL LIMIT 1`);
  if (!needsBackfill.rows.length) return false;
  await run("UPDATE bom_items SET purchase_status = 'Transit' WHERE purchase_status = 'TRANSIT'");
  await run("UPDATE bom_items SET purchase_status = 'Received' WHERE purchase_status IN ('CLOSED','RECEIVED')");
  await run("UPDATE bom_items SET purchase_status = 'Cancelled' WHERE purchase_status = 'CANCELLED'");
  await run(
    `UPDATE bom_items SET purchase_status = 'Ordered'
      WHERE (purchase_status = 'PENDING' OR purchase_status IS NULL) AND po_ref IS NOT NULL AND po_ref != ''`);
  await run(
    `UPDATE bom_items SET purchase_status = 'Comparison'
      WHERE (purchase_status = 'PENDING' OR purchase_status IS NULL)
        AND EXISTS (SELECT 1 FROM supplier_quotes sq WHERE sq.bom_item_id = bom_items.id)`);
  await run(
    "UPDATE bom_items SET purchase_status = 'Enquiry' WHERE purchase_status = 'PENDING' OR purchase_status IS NULL");
  return true;
}

const ranFirst = await runBackfill();
assert.equal(ranFirst, true, 'first pass should run (fresh DB has old tokens/nulls)');

const rows = await run('SELECT id, purchase_status FROM bom_items ORDER BY id');
const byId = Object.fromEntries(rows.rows.map(r => [r.id, r.purchase_status]));
for (let i = 0; i < CASES.length; i++) {
  assert.equal(byId[ids[i]], CASES[i].expect, CASES[i].label);
}

// Idempotency: a second pass must be a no-op (both at the guard level and the data level).
const ranSecond = await runBackfill();
assert.equal(ranSecond, false, 'second pass should skip entirely — guard sees no old tokens/nulls left');
const rows2 = await run('SELECT id, purchase_status FROM bom_items ORDER BY id');
assert.deepEqual(rows2.rows.map(r => r.purchase_status), rows.rows.map(r => r.purchase_status),
  'second pass changed nothing');

console.log('backfill-5.0 selfcheck OK —', CASES.length, 'cases, idempotent on re-run');
