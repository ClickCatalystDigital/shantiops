// scripts/selfcheck-named-parts.mjs — runnable check for the named-boiler-parts reconciliation
// logic (lib/qc-bom-sync.js's namedPartRows/reconcilePartsCertificates). Same precedent as
// scripts/remnant-cutting-selfcheck.mjs: lib/qc-bom-sync.js pulls in the real Turso connection via
// lib/data.js/lib/db.js, so it can't be imported directly into a check that shouldn't touch the
// live DB — an in-memory libsql DB with synthetic fixtures, and the core logic copied by hand, kept
// in lockstep with lib/qc-bom-sync.js.
//   node scripts/selfcheck-named-parts.mjs
import assert from 'node:assert/strict';
import { createClient } from '@libsql/client';

const db = createClient({ url: ':memory:' });
async function run(sql, args = []) { return db.execute({ sql, args }); }
async function all(sql, args = []) { return (await run(sql, args)).rows; }

await run(`CREATE TABLE bom_items (id INTEGER PRIMARY KEY AUTOINCREMENT, material_description TEXT)`);
await run(`CREATE TABLE stock_pieces (id INTEGER PRIMARY KEY AUTOINCREMENT, bom_item_id INTEGER, part_name TEXT, test_certificate_id INTEGER)`);
await run(`CREATE TABLE qc_document_parts (
  id INTEGER PRIMARY KEY AUTOINCREMENT, document_id INTEGER, part_no TEXT, part_name TEXT,
  qty TEXT, bom_item_id INTEGER, sort_order INTEGER, stock_piece_id INTEGER, test_certificate_id INTEGER
)`);

// ---- namedPartRows (mirrors lib/qc-bom-sync.js) ----
function namedPartRows(b) {
  if (b.named_parts_json) {
    try {
      const parsed = JSON.parse(b.named_parts_json)
        .map(p => ({ part_name: String(p?.name || '').trim(), qty: p?.qty }))
        .filter(p => p.part_name);
      if (parsed.length) return parsed.map(p => ({ part_name: p.part_name, qty: String(p.qty || 1) }));
    } catch { /* fall through */ }
  }
  return [{ part_name: b.material_description, qty: b.qty_text || '1' }];
}

// ---- reconcilePartsCertificates (mirrors lib/qc-bom-sync.js) ----
async function reconcilePartsCertificates(documentId) {
  const unlinked = await all(
    `SELECT qdp.id, qdp.bom_item_id, qdp.part_name FROM qc_document_parts qdp
     JOIN bom_items bi ON bi.id = qdp.bom_item_id
     WHERE qdp.document_id = ? AND qdp.test_certificate_id IS NULL AND qdp.part_name != bi.material_description`,
    [documentId]);
  for (const row of unlinked) {
    const pieces = await all(
      'SELECT id, test_certificate_id FROM stock_pieces WHERE bom_item_id = ? AND part_name = ? ORDER BY id DESC',
      [row.bom_item_id, row.part_name]);
    if (!pieces.length) continue;
    const certs = [...new Set(pieces.map(p => p.test_certificate_id).filter(Boolean))];
    if (certs.length !== 1) continue;
    await run('UPDATE qc_document_parts SET stock_piece_id = ?, test_certificate_id = ? WHERE id = ? AND test_certificate_id IS NULL',
      [pieces[0].id, certs[0], row.id]);
  }
}

async function insertPart(documentId, bomItemId, part, sortOrder) {
  const res = await run(
    `INSERT OR IGNORE INTO qc_document_parts (document_id, part_no, part_name, qty, bom_item_id, sort_order)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [documentId, String(sortOrder + 1), part.part_name, part.qty, bomItemId, sortOrder]);
  return Number(res.rowsAffected) > 0;
}

// A partial unique index (document_id, bom_item_id, part_name) WHERE bom_item_id IS NOT NULL is
// what INSERT OR IGNORE relies on for idempotent re-sync — sqlite's :memory: engine enforces
// UNIQUE the same way the live Turso DB's index does, so this check exercises the real constraint.
await run(`CREATE UNIQUE INDEX idx_uniq ON qc_document_parts(document_id, bom_item_id, part_name) WHERE bom_item_id IS NOT NULL`);

// ---- Test 1: named parts create separate, distinctly-numbered rows ----
const { lastInsertRowid: bomA } = await run(
  `INSERT INTO bom_items (material_description) VALUES ('MS PLATE')`);
const partsA = namedPartRows({ material_description: 'MS PLATE', named_parts_json: JSON.stringify([{ name: 'SHELL BELT-I', qty: 1 }, { name: 'SHELL BELT-IIA', qty: 1 }]) });
assert.equal(partsA.length, 2);
let sortOrder = 0;
for (const p of partsA) { if (await insertPart(1, Number(bomA), p, sortOrder)) sortOrder++; }
let rows = await all('SELECT part_name FROM qc_document_parts WHERE document_id = 1 ORDER BY id');
assert.deepEqual(rows.map(r => r.part_name), ['SHELL BELT-I', 'SHELL BELT-IIA']);
console.log('1. named parts -> separate rows: ok');

// ---- Test 2: re-sync doesn't duplicate (both named parts and the plain fallback) ----
for (const p of partsA) { await insertPart(1, Number(bomA), p, sortOrder); } // re-run, same doc
rows = await all('SELECT part_name FROM qc_document_parts WHERE document_id = 1');
assert.equal(rows.length, 2, 're-sync must not duplicate named-part rows');
const { lastInsertRowid: bomB } = await run(`INSERT INTO bom_items (material_description) VALUES ('MS ANGLE 50X50X5')`);
const fallback = namedPartRows({ material_description: 'MS ANGLE 50X50X5', qty_text: '4 Nos' });
assert.deepEqual(fallback, [{ part_name: 'MS ANGLE 50X50X5', qty: '4 Nos' }]);
await insertPart(1, Number(bomB), fallback[0], sortOrder);
await insertPart(1, Number(bomB), fallback[0], sortOrder); // re-sync
rows = await all('SELECT * FROM qc_document_parts WHERE bom_item_id = ?', [Number(bomB)]);
assert.equal(rows.length, 1, 're-sync must not duplicate the plain fallback row either');
console.log('2. re-sync is idempotent for both named and fallback rows: ok');

// ---- Test 3: reconciliation ignores the fallback row (part_name == material_description) ----
await reconcilePartsCertificates(1);
const fallbackRow = (await all('SELECT * FROM qc_document_parts WHERE bom_item_id = ?', [Number(bomB)]))[0];
assert.equal(fallbackRow.stock_piece_id, null, 'fallback row must never be reconciled');
console.log('3. fallback row excluded from reconciliation: ok');

// ---- Test 4: single agreeing certificate auto-links (even with partial fulfillment) ----
await run(`INSERT INTO stock_pieces (bom_item_id, part_name, test_certificate_id) VALUES (?, 'SHELL BELT-I', 501)`, [Number(bomA)]);
await reconcilePartsCertificates(1);
let linked = (await all(`SELECT * FROM qc_document_parts WHERE bom_item_id = ? AND part_name = 'SHELL BELT-I'`, [Number(bomA)]))[0];
assert.equal(linked.test_certificate_id, 501);
assert.ok(linked.stock_piece_id, 'stock_piece_id must be set as the representative reference');
console.log('4. single-candidate reconciliation (partial fulfillment) links: ok');

// ---- Test 5: conflicting certificates across pieces never guess ----
await run(`INSERT INTO stock_pieces (bom_item_id, part_name, test_certificate_id) VALUES (?, 'SHELL BELT-IIA', 601)`, [Number(bomA)]);
await run(`INSERT INTO stock_pieces (bom_item_id, part_name, test_certificate_id) VALUES (?, 'SHELL BELT-IIA', 602)`, [Number(bomA)]);
await reconcilePartsCertificates(1);
let conflicted = (await all(`SELECT * FROM qc_document_parts WHERE bom_item_id = ? AND part_name = 'SHELL BELT-IIA'`, [Number(bomA)]))[0];
assert.equal(conflicted.test_certificate_id, null, 'conflicting certs must never be auto-linked');
console.log('5. conflicting certificates stay unlinked: ok');

// ---- Test 6: a manual link is never overwritten by a later reconcile pass ----
await run(`UPDATE qc_document_parts SET test_certificate_id = 999, stock_piece_id = NULL WHERE bom_item_id = ? AND part_name = 'SHELL BELT-IIA'`, [Number(bomA)]);
await run(`DELETE FROM stock_pieces WHERE bom_item_id = ? AND part_name = 'SHELL BELT-IIA' AND test_certificate_id = 602`, [Number(bomA)]); // now only one real cert (601) exists, differing from the manual pick (999)
await reconcilePartsCertificates(1);
let manual = (await all(`SELECT * FROM qc_document_parts WHERE bom_item_id = ? AND part_name = 'SHELL BELT-IIA'`, [Number(bomA)]))[0];
assert.equal(manual.test_certificate_id, 999, 'a manual link must survive reconciliation even when it disagrees with the physical evidence');
console.log('6. manual link is never overwritten: ok');

console.log('\nAll named-parts self-checks passed.');
