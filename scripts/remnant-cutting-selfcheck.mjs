// scripts/remnant-cutting-selfcheck.mjs — runnable check for Cutting & Remnant Management
// (lib/stock-pieces.js's weight/cut engine + lib/remnant-match.js's matching engine). Same
// precedent as scripts/advance-status-selfcheck.mjs: those files use ESM `import` syntax as plain
// .js (only ever run through Next's bundler), so a self-check can't import them directly — an
// in-memory libsql DB with synthetic fixtures, and the core logic copied by hand, kept in lockstep.
//   node scripts/remnant-cutting-selfcheck.mjs
import assert from 'node:assert';
import { createClient } from '@libsql/client';

const db = createClient({ url: ':memory:' });
async function run(sql, args = []) { return db.execute({ sql, args }); }
async function one(sql, args = []) { return (await run(sql, args)).rows[0]; }

await run(`CREATE TABLE inventory_items (
  id INTEGER PRIMARY KEY, description TEXT, spec TEXT, moc TEXT, category TEXT,
  track_pieces INTEGER DEFAULT 0, on_hand REAL DEFAULT 0, item_id INTEGER
)`);
await run(`CREATE TABLE stock_pieces (
  id INTEGER PRIMARY KEY AUTOINCREMENT, inventory_item_id INTEGER, code TEXT, kind TEXT,
  length_mm REAL, width_mm REAL, thickness_mm REAL, kg_per_m REAL, density REAL, weight_kg REAL DEFAULT 0,
  status TEXT DEFAULT 'available', source TEXT DEFAULT 'purchase', parent_id INTEGER, root_id INTEGER,
  heat_no TEXT, project_id INTEGER, bom_item_id INTEGER
)`);
// Same shape as lib/db.js's real counters table — nextSeq() below mirrors nextPieceSeq() in
// lib/stock-pieces.js, the atomic root-relative sequence behind the flattened lineage-code fix.
await run(`CREATE TABLE counters (name TEXT PRIMARY KEY, value INTEGER NOT NULL DEFAULT 1000)`);
await run(`CREATE TABLE bom_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER, material_description TEXT, moc TEXT,
  size_spec TEXT, qty_text TEXT, purchase_status TEXT, category TEXT, category_fields_json TEXT,
  pending_review INTEGER DEFAULT 0, item_id INTEGER
)`);

// ---- pieceWeight (mirrors lib/stock-pieces.js) ----
function pieceWeight({ kind, length_mm, width_mm, thickness_mm, density, kg_per_m }) {
  if (kind === 'plate') {
    const L = Number(length_mm), W = Number(width_mm), T = Number(thickness_mm);
    if (!(L > 0 && W > 0 && T > 0)) return 0;
    return (L / 1000) * (W / 1000) * (T / 1000) * (Number(density) || 7850);
  }
  const L = Number(length_mm), K = Number(kg_per_m);
  if (!(L > 0 && K > 0)) return 0;
  return (L / 1000) * K;
}
const round2 = n => Math.round(n * 100) / 100;

assert.strictEqual(round2(pieceWeight({ kind: 'plate', length_mm: 1000, width_mm: 2000, thickness_mm: 10, density: 7850 })), 157, '1000x2000x10 steel plate should be 157 kg');
assert.strictEqual(round2(pieceWeight({ kind: 'plate', length_mm: 1500, width_mm: 6000, thickness_mm: 10, density: 7850 })), 706.5, '1500x6000x10 steel plate should be 706.5 kg');
assert.strictEqual(pieceWeight({ kind: 'linear', length_mm: 6000, kg_per_m: 5 }), 30, '6m of 5kg/m section should be 30 kg');
assert.strictEqual(pieceWeight({ kind: 'plate', length_mm: 0, width_mm: 100, thickness_mm: 10 }), 0, 'zero dimension yields zero weight, not NaN/negative');
console.log('pieceWeight: ok');

// ---- lineage code + heat-in-id (mirrors lib/stock-pieces.js's rootCode/sanitizeHeatForCode/
// nextPieceSeq) — the Planning Backlog fix: every descendant of one physical delivery is numbered
// flat against the ROOT's own code, never compounding onto whichever immediate parent was cut, and
// a known heat number rides directly in the code string.
function sanitizeHeatForCode(heatNo) { return String(heatNo || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10); }
function rootCode(kind, id, heatNo) {
  const base = `${kind === 'plate' ? 'PL' : 'LN'}-${String(id).padStart(4, '0')}`;
  const h = sanitizeHeatForCode(heatNo);
  return h ? `${base}-H${h}` : base;
}
async function nextSeq(rootId, letter) {
  const r = await run(
    `INSERT INTO counters (name, value) VALUES (?, 1)
     ON CONFLICT(name) DO UPDATE SET value = value + 1
     RETURNING value`,
    [`piece_seq:${rootId}:${letter}`]
  );
  return r.rows[0].value;
}

// ---- cutPiece (mirrors lib/stock-pieces.js's transaction, minus withTransaction wrapping) ----
// Phase 0 fix mirrored here: the status flip is a compare-and-swap (WHERE ... AND status = ...),
// and any present-but-invalid used/remnant entry hard-throws instead of being silently skipped.
// Material Indent hard gate (2026-09-02): tightened from `IN ('available','reserved')` to
// `= 'reserved'` only — a piece may only be cut once it's reserved (via the automatic BOM match or
// a Stores-authorized indent release), never while merely 'available'. Kept in lockstep here since
// this file hand-mirrors the real function (see this file's own header comment).
async function cutPiece({ sourcePieceId, used = [], remnants = [], projectId, bomItemId }) {
  const source = await one('SELECT * FROM stock_pieces WHERE id = ?', [sourcePieceId]);
  const dims = p => ({ kind: source.kind, ...p, density: source.density, kg_per_m: source.kg_per_m });
  const usedWeight = used.reduce((s, u) => s + pieceWeight(dims(u)), 0);
  const remnantWeight = remnants.reduce((s, r) => s + pieceWeight(dims(r)), 0);
  assert.ok(usedWeight + remnantWeight <= source.weight_kg + 0.01, 'used+remnant must not exceed source');
  const scrapWeight = Math.max(0, round2(source.weight_kg - usedWeight - remnantWeight));
  for (const u of used) if (!(pieceWeight(dims(u)) > 0)) throw new Error('Used piece: enter valid dimensions');
  for (const r of remnants) if (!(pieceWeight(dims(r)) > 0)) throw new Error('Remnant: enter valid dimensions');

  const rootId = source.root_id || source.id;
  const rootRow = rootId === source.id ? source : await one('SELECT code FROM stock_pieces WHERE id = ?', [rootId]);
  const rootCodeStr = rootRow.code;

  const flip = await run("UPDATE stock_pieces SET status = 'consumed' WHERE id = ? AND status = 'reserved'", [sourcePieceId]);
  if (Number(flip.rowsAffected) !== 1) throw new Error(`Can't cut — must be reserved first (currently ${source.status})`);
  const childIds = { used: [], remnants: [] };
  for (const u of used) {
    const seq = await nextSeq(rootId, 'U');
    const ins = await run(
      `INSERT INTO stock_pieces (inventory_item_id, kind, length_mm, width_mm, thickness_mm, density, kg_per_m, weight_kg, status, source, parent_id, root_id, heat_no, project_id, bom_item_id, code)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'consumed', 'remnant', ?, ?, ?, ?, ?, ?)`,
      [source.inventory_item_id, source.kind, u.length_mm || null, u.width_mm || null, u.thickness_mm || null,
        source.density, source.kg_per_m, round2(pieceWeight(dims(u))), sourcePieceId, rootId, source.heat_no || null,
        projectId || null, bomItemId || null, `${rootCodeStr}-U${seq}`]
    );
    childIds.used.push(Number(ins.lastInsertRowid));
  }
  for (const r of remnants) {
    const seq = await nextSeq(rootId, 'R');
    const ins = await run(
      `INSERT INTO stock_pieces (inventory_item_id, kind, length_mm, width_mm, thickness_mm, density, kg_per_m, weight_kg, status, source, parent_id, root_id, heat_no, code)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'available', 'remnant', ?, ?, ?, ?)`,
      [source.inventory_item_id, source.kind, r.length_mm || null, r.width_mm || null, r.thickness_mm || null,
        source.density, source.kg_per_m, round2(pieceWeight(dims(r))), sourcePieceId, rootId, source.heat_no || null,
        `${rootCodeStr}-R${seq}`]
    );
    childIds.remnants.push(Number(ins.lastInsertRowid));
  }
  if (scrapWeight > 0) {
    const seq = await nextSeq(rootId, 'S');
    await run(`INSERT INTO stock_pieces (inventory_item_id, kind, weight_kg, status, source, parent_id, root_id, heat_no, code) VALUES (?, ?, ?, 'scrap', 'remnant', ?, ?, ?, ?)`,
      [source.inventory_item_id, source.kind, scrapWeight, sourcePieceId, rootId, source.heat_no || null, `${rootCodeStr}-S${seq}`]);
  }
  if (bomItemId) {
    const remaining = await one("SELECT COUNT(*) AS n FROM stock_pieces WHERE bom_item_id = ? AND status = 'reserved'", [bomItemId]);
    if (remaining.n === 0) await run("UPDATE bom_items SET purchase_status = 'In-Stock' WHERE id = ?", [bomItemId]);
  }
  return { usedWeight: round2(usedWeight), remnantWeight: round2(remnantWeight), scrapWeight, childIds };
}

await run(`INSERT INTO inventory_items (id, description, moc, category) VALUES (1, 'MS Plate 10mm', 'IS 2062 E250', 'plate')`);
await run(`INSERT INTO stock_pieces (id, inventory_item_id, code, kind, length_mm, width_mm, thickness_mm, density, weight_kg, status)
           VALUES (1, 1, 'PL-0001', 'plate', 1500, 6000, 10, 7850, 706.5, 'reserved')`);

// ---- Material Indent hard gate: an 'available' (not yet reserved) piece must never be cuttable ----
{
  await run(`INSERT INTO stock_pieces (id, inventory_item_id, code, kind, length_mm, width_mm, thickness_mm, density, weight_kg, status)
             VALUES (999, 1, 'PL-0999', 'plate', 500, 500, 10, 7850, 19.6, 'available')`);
  await assert.rejects(
    () => cutPiece({ sourcePieceId: 999, used: [{ length_mm: 100, width_mm: 100, thickness_mm: 10 }], remnants: [] }),
    /must be reserved first/,
    'a bare available piece — never reserved via a BOM auto-match or a Stores-authorized indent — must be rejected'
  );
  const untouched999 = await one('SELECT status FROM stock_pieces WHERE id = 999');
  assert.strictEqual(untouched999.status, 'available', 'the unreserved piece must be untouched after the rejected cut');
}
console.log('cutPiece hard gate: ok (available piece rejected, reserved required)');

{
  const r = await cutPiece({ sourcePieceId: 1, used: [{ length_mm: 1000, width_mm: 2000, thickness_mm: 10 }], remnants: [{ length_mm: 500, width_mm: 2000, thickness_mm: 10 }] });
  assert.strictEqual(r.usedWeight, 157);
  assert.strictEqual(r.remnantWeight, 78.5);
  assert.strictEqual(round2(r.usedWeight + r.remnantWeight + r.scrapWeight), 706.5, 'used+remnant+scrap must sum back to the source weight');

  const source = await one('SELECT status FROM stock_pieces WHERE id = 1');
  assert.strictEqual(source.status, 'consumed', 'source piece must be consumed after cut');
  const children = (await run('SELECT * FROM stock_pieces WHERE parent_id = 1')).rows;
  assert.strictEqual(children.length, 3, 'expected one used, one remnant, one scrap child');
  const remnant = children.find(c => c.source === 'remnant' && c.status === 'available');
  assert.ok(remnant, 'remnant child must be available (back in stock)');
  assert.strictEqual(remnant.weight_kg, 78.5);
}
console.log('cutPiece: ok (lineage, weight conservation) — A0.3: conservation regression check passes unmodified');

// ---- A0.1: concurrency guard — two "concurrent" cuts of the same piece must not both win ----
{
  await run(`INSERT INTO stock_pieces (id, inventory_item_id, code, kind, length_mm, width_mm, thickness_mm, density, weight_kg, status)
             VALUES (100, 1, 'PL-0002', 'plate', 1000, 1000, 10, 7850, 78.5, 'reserved')`);
  // Both "callers" read the same reserved status before either writes — the exact race window
  // lib/stock-pieces.js's pre-transaction SELECT (line 66) allows. The CAS UPDATE, not read timing,
  // must be what decides the winner.
  const seenByBoth = await one('SELECT status FROM stock_pieces WHERE id = 100');
  assert.strictEqual(seenByBoth.status, 'reserved', 'both concurrent callers see reserved before either commits');

  async function attemptCut() {
    const flip = await run("UPDATE stock_pieces SET status = 'consumed' WHERE id = 100 AND status = 'reserved'");
    return Number(flip.rowsAffected) === 1;
  }
  const first = await attemptCut();
  const second = await attemptCut();
  assert.strictEqual(first, true, 'first concurrent cut must win the compare-and-swap');
  assert.strictEqual(second, false, 'second concurrent cut must lose — no double-materialized children');
  const finalState = await one('SELECT status FROM stock_pieces WHERE id = 100');
  assert.strictEqual(finalState.status, 'consumed', 'exactly one consumed transition, not two');
}
console.log('cutPiece concurrency guard: ok (A0.1)');

// ---- A0.2: invalid input must hard-reject, never silently skip ----
{
  await run(`INSERT INTO stock_pieces (id, inventory_item_id, code, kind, length_mm, width_mm, thickness_mm, density, weight_kg, status)
             VALUES (101, 1, 'PL-0003', 'plate', 1000, 1000, 10, 7850, 78.5, 'reserved')`);
  await assert.rejects(
    () => cutPiece({ sourcePieceId: 101, used: [{ length_mm: 0, width_mm: 500, thickness_mm: 10 }], remnants: [] }),
    /enter valid dimensions/,
    'a used entry with zero length must be rejected, not silently dropped into the scrap residual'
  );
  await assert.rejects(
    () => cutPiece({ sourcePieceId: 101, used: [], remnants: [{ length_mm: -100, width_mm: 500, thickness_mm: 10 }] }),
    /enter valid dimensions/,
    'a remnant entry with negative length must be rejected'
  );
  const untouched = await one('SELECT status FROM stock_pieces WHERE id = 101');
  assert.strictEqual(untouched.status, 'reserved', 'source piece must be untouched after a rejected cut');
  const noChildren = await run('SELECT COUNT(*) AS n FROM stock_pieces WHERE parent_id = 101');
  assert.strictEqual(noChildren.rows[0].n, 0, 'zero children must be written when the cut is rejected');
}
console.log('cutPiece invalid-input guard: ok (A0.2)');

// ---- rootCode/sanitizeHeatForCode: pure logic, direct assertions ----
{
  assert.strictEqual(rootCode('plate', 7, null), 'PL-0007', 'no heat -> bare root code, unchanged from before this fix');
  assert.strictEqual(rootCode('linear', 7, ''), 'LN-0007', 'blank heat -> no H segment');
  assert.strictEqual(rootCode('plate', 42, '62A/5678'), 'PL-0042-H62A5678', 'heat is sanitized (slash stripped) and embedded');
  assert.strictEqual(rootCode('plate', 42, 'sail heat 001'), 'PL-0042-HSAILHEAT00', 'lowercase uppercased, spaces stripped, capped at 10 chars');
  assert.strictEqual(rootCode('plate', 42, '///'), 'PL-0042', 'a heat number that sanitizes to nothing falls back to the bare code, never a dangling "-H"');
}
console.log('rootCode/sanitizeHeatForCode: ok');

// ---- lineage-code flattening (Planning Backlog fix): a remnant cut a SECOND time must read
// PL-000N-R2, not the old compounding PL-000N-R1-R1 ----
{
  // Root code must already carry the heat segment, matching what receivePiece() computes at real
  // insert time — a fixture with a bare code + a heat_no would be an inconsistent state that never
  // actually occurs, since rootCode() is what produces a root's own code in the first place.
  await run(`INSERT INTO stock_pieces (id, inventory_item_id, code, kind, length_mm, width_mm, thickness_mm, density, weight_kg, status, heat_no)
             VALUES (200, 1, ?, 'plate', 1500, 6000, 10, 7850, 706.5, 'reserved', '62A5678')`, [rootCode('plate', 200, '62A5678')]);
  const first = await cutPiece({ sourcePieceId: 200, used: [{ length_mm: 1000, width_mm: 2000, thickness_mm: 10 }], remnants: [{ length_mm: 500, width_mm: 2000, thickness_mm: 10 }] });
  const usedChild = await one('SELECT code, heat_no FROM stock_pieces WHERE id = ?', [first.childIds.used[0]]);
  const remnantChild = await one('SELECT id, code, status, heat_no FROM stock_pieces WHERE id = ?', [first.childIds.remnants[0]]);
  assert.strictEqual(usedChild.code, 'PL-0200-H62A5678-U1', 'first used child carries the root heat + flat U1 (verifies both fixes together)');
  assert.strictEqual(remnantChild.code, 'PL-0200-H62A5678-R1', 'first remnant child is flat R1, and inherits the heat number');
  assert.strictEqual(remnantChild.heat_no, '62A5678', 'heat number inherited from the root, not re-entered');

  // Cut that remnant again — the actual regression this whole fix exists for.
  await run("UPDATE stock_pieces SET status = 'reserved' WHERE id = ?", [remnantChild.id]);
  const second = await cutPiece({ sourcePieceId: remnantChild.id, used: [{ length_mm: 300, width_mm: 2000, thickness_mm: 10 }], remnants: [{ length_mm: 150, width_mm: 2000, thickness_mm: 10 }] });
  const usedChild2 = await one('SELECT code FROM stock_pieces WHERE id = ?', [second.childIds.used[0]]);
  const remnantChild2 = await one('SELECT code FROM stock_pieces WHERE id = ?', [second.childIds.remnants[0]]);
  assert.strictEqual(usedChild2.code, 'PL-0200-H62A5678-U2', 'second-generation used child continues the ROOT\'s U sequence (U2), not PL-0200-R1-U1');
  assert.strictEqual(remnantChild2.code, 'PL-0200-H62A5678-R2', 'second-generation remnant is flat R2, not the old compounding PL-0200-R1-R1');
}
console.log('lineage-code flattening: ok (a re-cut remnant numbers flat against the root, heat number rides in every descendant\'s code)');

// ---- remnant matching (mirrors lib/remnant-match.js, minus imports it can't load standalone) ----
function normalizeMaterial(s) { return String(s || '').trim().toLowerCase().replace(/\s+/g, ' '); }
function parseNum(v) { if (v == null) return null; const m = String(v).match(/-?\d+(?:\.\d+)?/); return m ? Number(m[0]) : null; }
function parseDims(bomItem) {
  if (!bomItem.category || !bomItem.category_fields_json) return null;
  let f; try { f = JSON.parse(bomItem.category_fields_json); } catch { return null; }
  if (bomItem.category === 'plate') {
    const length_mm = parseNum(f.length), width_mm = parseNum(f.width), thickness_mm = parseNum(f.thickness);
    if (!(length_mm > 0 && width_mm > 0 && thickness_mm > 0)) return null;
    return { kind: 'plate', length_mm, width_mm, thickness_mm };
  }
  return null;
}
async function findCandidates(bomItem) {
  const req = parseDims(bomItem);
  if (!req) return [];
  const reqMoc = normalizeMaterial(bomItem.moc);
  if (!reqMoc && !bomItem.item_id) return [];
  const rows = (await run(
    `SELECT sp.*, i.moc AS inv_moc, i.item_id AS inv_item_id FROM stock_pieces sp JOIN inventory_items i ON i.id = sp.inventory_item_id
      WHERE sp.status = 'available' AND i.track_pieces = 1 AND i.category = ?`, [bomItem.category])).rows;
  const scored = [];
  for (const p of rows) {
    const identityMatch = bomItem.item_id && p.inv_item_id && bomItem.item_id === p.inv_item_id;
    if (!identityMatch && normalizeMaterial(p.inv_moc) !== reqMoc) continue;
    if (Math.abs(Number(p.thickness_mm) - req.thickness_mm) > 0.3) continue;
    const straight = p.length_mm >= req.length_mm && p.width_mm >= req.width_mm;
    const rotated = p.length_mm >= req.width_mm && p.width_mm >= req.length_mm;
    if (!straight && !rotated) continue;
    scored.push({ piece: p, waste: (p.length_mm * p.width_mm) - (req.length_mm * req.width_mm) });
  }
  scored.sort((a, b) => a.waste - b.waste);
  return scored.map(s => s.piece);
}
function splitQtyText(qtyText, qtyA, qtyB) {
  const m = String(qtyText || '').match(/^\s*(\d+(?:\.\d+)?)\s*(.*)$/);
  const suffix = m ? m[2].trim() : '';
  return [suffix ? `${qtyA} ${suffix}` : `${qtyA}`, suffix ? `${qtyB} ${suffix}` : `${qtyB}`];
}
async function matchAndReserve(bomItem) {
  const req = parseDims(bomItem);
  if (!req) return { matched: 0 };
  const qtyMatch = String(bomItem.qty_text || '').match(/^\s*(\d+(?:\.\d+)?)/);
  const required = qtyMatch ? Number(qtyMatch[1]) : 0;
  if (!(required > 0)) return { matched: 0 };
  const candidates = await findCandidates(bomItem);
  const reservedIds = [];
  for (const c of candidates) {
    if (reservedIds.length >= required) break;
    const res = await run("UPDATE stock_pieces SET status = 'reserved' WHERE id = ? AND status = 'available'", [c.id]);
    if (res.rowsAffected === 1) reservedIds.push(c.id);
  }
  const K = reservedIds.length;
  if (K === 0) return { matched: 0 };
  let targetBomItemId = bomItem.id;
  if (K < required) {
    const shortfall = required - K;
    const [remainingQtyText, reservedQtyText] = splitQtyText(bomItem.qty_text, shortfall, K);
    await run('UPDATE bom_items SET qty_text = ? WHERE id = ?', [remainingQtyText, bomItem.id]);
    const ins = await run(
      `INSERT INTO bom_items (project_id, material_description, moc, size_spec, qty_text, category, category_fields_json, pending_review)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
      [bomItem.project_id, bomItem.material_description, bomItem.moc, bomItem.size_spec || null, reservedQtyText, bomItem.category, bomItem.category_fields_json]
    );
    targetBomItemId = Number(ins.lastInsertRowid);
  } else {
    await run('UPDATE bom_items SET pending_review = 1 WHERE id = ?', [bomItem.id]);
  }
  for (const id of reservedIds) await run('UPDATE stock_pieces SET bom_item_id = ? WHERE id = ?', [targetBomItemId, id]);
  return { matched: K, shortfall: Math.max(0, required - K), targetBomItemId };
}

// Fixture: two plates, same material — one exact-thickness-mismatch decoy, one real candidate that
// only fits rotated, one undersized decoy.
await run(`DELETE FROM stock_pieces`);
await run(`INSERT INTO inventory_items (id, description, moc, category, track_pieces) VALUES (2, 'MS Plate', 'IS 2062 E250', 'plate', 1)`);
await run(`INSERT INTO stock_pieces (inventory_item_id, code, kind, length_mm, width_mm, thickness_mm, density, weight_kg, status) VALUES
  (2, 'PL-A', 'plate', 900, 2100, 12, 7850, 178.4, 'available'),  -- wrong thickness (12 vs required 10)
  (2, 'PL-B', 'plate', 2100, 900, 10, 7850, 148.7, 'available'),  -- fits only rotated (2100x900 vs required 900x2000)
  (2, 'PL-C', 'plate', 900, 1000, 10, 7850, 70.7, 'available')`); // too small

const bomLine = { id: 100, project_id: 1, material_description: 'MS Plate', moc: 'IS 2062 E250', qty_text: '1 Nos', category: 'plate',
  category_fields_json: JSON.stringify({ length: '2000', width: '900', thickness: '10' }) };
await run(`INSERT INTO bom_items (id, project_id, material_description, moc, qty_text, category, category_fields_json) VALUES
  (100, 1, 'MS Plate', 'IS 2062 E250', '1 Nos', 'plate', ?)`, [bomLine.category_fields_json]);

{
  const candidates = await findCandidates(bomLine);
  assert.strictEqual(candidates.length, 1, 'exactly one candidate should survive thickness + size filtering');
  assert.strictEqual(candidates[0].code, 'PL-B', 'the rotated-fit plate is the only real match');

  const r = await matchAndReserve(bomLine);
  assert.strictEqual(r.matched, 1);
  assert.strictEqual(r.shortfall, 0);
  const piece = await one("SELECT status, bom_item_id FROM stock_pieces WHERE code = 'PL-B'");
  assert.strictEqual(piece.status, 'reserved', 'matched piece must be reserved, not left available');
  assert.strictEqual(piece.bom_item_id, 100);
  const bi = await one('SELECT pending_review FROM bom_items WHERE id = 100');
  assert.strictEqual(bi.pending_review, 1, 'a fully-matched line must be forced pending_review=1 (permanently hidden from Procurement)');
}
console.log('matchAndReserve (full match, rotation, thickness filter): ok');

// Double-booking: a second identical BOM line must find nothing (PL-B is already reserved).
{
  const bomLine2 = { ...bomLine, id: 101 };
  await run(`INSERT INTO bom_items (id, project_id, material_description, moc, qty_text, category, category_fields_json) VALUES
    (101, 1, 'MS Plate', 'IS 2062 E250', '1 Nos', 'plate', ?)`, [bomLine.category_fields_json]);
  const r = await matchAndReserve(bomLine2);
  assert.strictEqual(r.matched, 0, 'a piece already reserved by one line must never be reservable by another');
}
console.log('double-booking prevention: ok');

// Partial match: required qty 3, only 1 available candidate -> split, clone carries qty 1 and
// pending_review=1, original keeps qty 2 for normal Stores review/Procure.
{
  await run(`DELETE FROM stock_pieces WHERE inventory_item_id = 2`);
  await run(`INSERT INTO stock_pieces (inventory_item_id, code, kind, length_mm, width_mm, thickness_mm, density, weight_kg, status) VALUES
    (2, 'PL-D', 'plate', 2000, 900, 10, 7850, 141.3, 'available')`);
  const bomLine3 = { id: 102, project_id: 1, material_description: 'MS Plate', moc: 'IS 2062 E250', qty_text: '3 Nos', category: 'plate',
    category_fields_json: bomLine.category_fields_json };
  await run(`INSERT INTO bom_items (id, project_id, material_description, moc, qty_text, category, category_fields_json)
             VALUES (102, 1, 'MS Plate', 'IS 2062 E250', '3 Nos', 'plate', ?)`, [bomLine.category_fields_json]);

  const r = await matchAndReserve(bomLine3);
  assert.strictEqual(r.matched, 1);
  assert.strictEqual(r.shortfall, 2);
  assert.notStrictEqual(r.targetBomItemId, 102, 'partial match must clone, not reuse the original row');

  const original = await one('SELECT qty_text, pending_review FROM bom_items WHERE id = 102');
  assert.strictEqual(original.qty_text, '2 Nos', 'original row keeps the unmet remainder');
  const clone = await one('SELECT qty_text, pending_review, category FROM bom_items WHERE id = ?', [r.targetBomItemId]);
  assert.strictEqual(clone.qty_text, '1 Nos');
  assert.strictEqual(clone.pending_review, 1, 'the fulfilled clone must be forced pending_review=1');
  assert.strictEqual(clone.category, 'plate', 'the clone must carry the category link forward (the bug this fixes)');
}
console.log('partial match split: ok');

// Item Master identity-first: a catalog-linked line (item_id set) with a blank moc must still
// match a catalog-linked piece sharing the same item_id — moc alone would reject this (blank never
// equals blank via the "must have something to compare" guard), identity carries it instead.
{
  await run(`DELETE FROM stock_pieces WHERE inventory_item_id = 2`);
  await run(`UPDATE inventory_items SET item_id = 555 WHERE id = 2`);
  await run(`INSERT INTO stock_pieces (inventory_item_id, code, kind, length_mm, width_mm, thickness_mm, density, weight_kg, status) VALUES
    (2, 'PL-E', 'plate', 2000, 1000, 10, 7850, 157, 'available')`);
  const identityLine = { id: 104, project_id: 1, material_description: 'MS Plate', moc: '', qty_text: '1 Nos', category: 'plate',
    category_fields_json: bomLine.category_fields_json, item_id: 555 };
  await run(`INSERT INTO bom_items (id, project_id, material_description, moc, qty_text, category, category_fields_json, item_id)
             VALUES (104, 1, 'MS Plate', '', '1 Nos', 'plate', ?, 555)`, [bomLine.category_fields_json]);

  const candidates = await findCandidates(identityLine);
  assert.strictEqual(candidates.length, 1, 'item_id identity alone (blank moc both sides) must still surface a candidate');
  const r = await matchAndReserve(identityLine);
  assert.strictEqual(r.matched, 1, 'identity-matched line must reserve despite no moc text to compare');
}
console.log('Item Master identity-first matching: ok');

console.log('\nAll Cutting & Remnant Management self-checks passed.');
