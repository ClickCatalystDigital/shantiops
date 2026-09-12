// scripts/stock-ownership-selfcheck.mjs — runnable check for Stores/Inventory hardening Phase 2's
// ownership-leak guards (lib/stock-pieces.js's rollUpOnHand/cutPiece/reservePiece, lib/remnant-
// match.js's findCandidates, lib/bom-receiving.js's maybeCreatePieceStock's isCountUnit gate). Same
// precedent as scripts/remnant-cutting-selfcheck.mjs: these files use ESM `import` syntax as plain
// .js (only ever run through Next's bundler), so a self-check can't import them directly — an
// in-memory libsql DB with synthetic fixtures, and the core logic copied by hand, kept in lockstep.
// The three real-DB guard queries were additionally proven live against real pre-existing data
// (see the Phase 2 report) — this script is the lasting, re-runnable artifact.
//   node scripts/stock-ownership-selfcheck.mjs
import assert from 'node:assert';
import { createClient } from '@libsql/client';

const db = createClient({ url: ':memory:' });
async function run(sql, args = []) { return db.execute({ sql, args }); }
async function one(sql, args = []) { return (await run(sql, args)).rows[0]; }
async function all(sql, args = []) { return (await run(sql, args)).rows; }

await run(`CREATE TABLE inventory_items (
  id INTEGER PRIMARY KEY, description TEXT, category TEXT, moc TEXT, spec TEXT,
  track_pieces INTEGER DEFAULT 0, on_hand REAL DEFAULT 0, item_id INTEGER
)`);
await run(`CREATE TABLE stock_pieces (
  id INTEGER PRIMARY KEY AUTOINCREMENT, inventory_item_id INTEGER, code TEXT, kind TEXT,
  length_mm REAL, width_mm REAL, thickness_mm REAL, weight_kg REAL DEFAULT 0,
  status TEXT DEFAULT 'available', source TEXT DEFAULT 'purchase', parent_id INTEGER,
  project_id INTEGER, bom_item_id INTEGER, owner_project_id INTEGER
)`);

// ---- mirrors lib/stock-pieces.js's rollUpOnHand() SQL exactly ----
async function rollUpOnHandCount(inventoryItemId) {
  const row = await one(
    "SELECT COUNT(*) AS n FROM stock_pieces WHERE inventory_item_id = ? AND status = 'available' AND owner_project_id IS NULL",
    [inventoryItemId]
  );
  return row.n;
}

// ---- mirrors lib/remnant-match.js's findCandidates() SQL exactly ----
async function findCandidates(category, forProjectId) {
  return all(
    `SELECT sp.id FROM stock_pieces sp JOIN inventory_items i ON i.id = sp.inventory_item_id
      WHERE sp.status = 'available' AND i.track_pieces = 1 AND i.category = ?
        AND (sp.owner_project_id IS NULL OR sp.owner_project_id = ?)`,
    [category, forProjectId]
  );
}

// ---- mirrors lib/stock-pieces.js's reservePiece() ownership guard exactly ----
async function reservePieceGuard(pieceId, projectId) {
  const piece = await one('SELECT owner_project_id FROM stock_pieces WHERE id = ?', [pieceId]);
  if (piece?.owner_project_id != null && piece.owner_project_id !== projectId) {
    throw new Error("This piece belongs to another project — it can't be reserved here without an ownership transfer");
  }
  return true;
}

// ---- mirrors lib/bom-receiving.js's isCountUnit() exactly ----
const COUNT_UNIT_SUFFIXES = new Set(['nos', 'no', 'no.', 'pcs', 'pc', 'ea', 'each', 'unit', 'units']);
function isCountUnit(qtyText) {
  const suffix = String(qtyText || '').replace(/^\s*[\d.]+\s*/, '').trim().toLowerCase();
  return COUNT_UNIT_SUFFIXES.has(suffix);
}

// === Fixtures: one common inventory_items row, one owned piece (Project 1), one common piece ===
await run(`INSERT INTO inventory_items (id, description, category, track_pieces, item_id) VALUES (1, 'MS Plate 10mm', 'plate', 1, 500)`);
await run(`INSERT INTO stock_pieces (inventory_item_id, kind, length_mm, width_mm, thickness_mm, weight_kg, status, owner_project_id) VALUES (1, 'plate', 2000, 1000, 10, 157, 'available', 1)`);
const ownedPieceId = (await one('SELECT id FROM stock_pieces WHERE owner_project_id = 1')).id;
await run(`INSERT INTO stock_pieces (inventory_item_id, kind, length_mm, width_mm, thickness_mm, weight_kg, status, owner_project_id) VALUES (1, 'plate', 1500, 800, 10, 94, 'available', NULL)`);

// 1. rollUpOnHand — owned piece must not count toward the shared on_hand figure; only the common one does.
assert.strictEqual(await rollUpOnHandCount(1), 1, 'on_hand rollup must exclude the owned piece');

// 2. findCandidates — Project 2 (unrelated) sees only the common piece; Project 1 (owner) sees both.
const forProject2 = await findCandidates('plate', 2);
assert.strictEqual(forProject2.length, 1, "an unrelated project must not see another project's owned piece");
assert.notStrictEqual(forProject2[0].id, ownedPieceId, 'the visible piece for Project 2 must not be the owned one');
const forProject1 = await findCandidates('plate', 1);
assert.strictEqual(forProject1.length, 2, 'the owning project must see both its own piece and common stock');

// 3. reservePiece guard — Project 2 rejected on the owned piece; Project 1 (owner) allowed; anyone allowed on common stock.
assert.throws(() => { throw new Error(); }, () => true); // sanity: assert.throws works in this Node
await assert.rejects(reservePieceGuard(ownedPieceId, 2), /belongs to another project/, 'a non-owning project must be rejected');
assert.strictEqual(await reservePieceGuard(ownedPieceId, 1), true, 'the owning project must be allowed to reserve its own piece');
const commonPieceId = forProject2[0].id;
assert.strictEqual(await reservePieceGuard(commonPieceId, 2), true, 'common (unowned) stock must be reservable by anyone');

// 4. isCountUnit — the qty-to-piece-count gate, verified against real observed qty_text values.
assert.strictEqual(isCountUnit('2 Nos'), true);
assert.strictEqual(isCountUnit('1 No'), true);
assert.strictEqual(isCountUnit('3 Pcs'), true);
assert.strictEqual(isCountUnit('6 Mtrs'), false, 'a length unit must never be read as a piece count');
assert.strictEqual(isCountUnit('80 kg'), false, 'a weight unit must never be read as a piece count');
assert.strictEqual(isCountUnit('1 SET'), false, 'a SET is not a single-shape unit count — must not guess');
assert.strictEqual(isCountUnit(''), false);
assert.strictEqual(isCountUnit(null), false);

console.log('stock-ownership-selfcheck: all assertions passed');
