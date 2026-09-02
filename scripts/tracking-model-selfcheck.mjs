// scripts/tracking-model-selfcheck.mjs — runnable check for Inventory Identity & Traceability,
// Phase 2 (lib/tracking-mode.js, lib/stock-receipts.js, lib/inventory-batches.js,
// lib/inventory-serials.js, and stock_pieces' pending_receipt handoff). Same in-memory-libsql
// precedent as scripts/remnant-cutting-selfcheck.mjs — the real logic lives in ESM .js only
// loadable through Next's bundler, so it's mirrored here by hand, kept in lockstep.
//   node scripts/tracking-model-selfcheck.mjs
import assert from 'node:assert';
import { createClient } from '@libsql/client';

const db = createClient({ url: ':memory:' });
async function run(sql, args = []) { return db.execute({ sql, args }); }
async function one(sql, args = []) { return (await run(sql, args)).rows[0]; }
async function all(sql, args = []) { return (await run(sql, args)).rows; }
const round2 = n => Math.round(n * 100) / 100;

await run(`CREATE TABLE suppliers (id INTEGER PRIMARY KEY, name TEXT)`);
await run(`CREATE TABLE purchase_orders (id INTEGER PRIMARY KEY, po_no TEXT)`);
await run(`CREATE TABLE projects (id INTEGER PRIMARY KEY, project_no TEXT)`);
await run(`CREATE TABLE bom_items (id INTEGER PRIMARY KEY, project_id INTEGER, material_description TEXT)`);
await run(`CREATE TABLE test_certificates (id INTEGER PRIMARY KEY, certificate_no TEXT, cast_no TEXT, heat_no TEXT)`);
await run(`CREATE TABLE inventory_items (id INTEGER PRIMARY KEY, description TEXT, on_hand REAL DEFAULT 0, tracking_mode TEXT NOT NULL DEFAULT 'scalar')`);
await run(`CREATE TABLE stock_receipts (
  id INTEGER PRIMARY KEY AUTOINCREMENT, inward_batch_no TEXT UNIQUE, supplier_id INTEGER, po_id INTEGER, grn_ref TEXT, received_by TEXT, received_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`);
await run(`CREATE TABLE stock_pieces (
  id INTEGER PRIMARY KEY AUTOINCREMENT, inventory_item_id INTEGER, code TEXT, kind TEXT, weight_kg REAL DEFAULT 0,
  status TEXT DEFAULT 'available', source TEXT DEFAULT 'purchase', parent_id INTEGER, project_id INTEGER, bom_item_id INTEGER,
  heat_no TEXT, test_certificate_id INTEGER, receipt_id INTEGER
)`);
await run(`CREATE TABLE inventory_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT, inventory_item_id INTEGER, receipt_id INTEGER, qty REAL DEFAULT 0,
  heat_no TEXT, supplier_batch_no TEXT, test_certificate_id INTEGER, status TEXT DEFAULT 'available'
)`);
await run(`CREATE TABLE inventory_serials (
  id INTEGER PRIMARY KEY AUTOINCREMENT, inventory_item_id INTEGER, receipt_id INTEGER, code TEXT, serial_no TEXT,
  test_certificate_id INTEGER, status TEXT DEFAULT 'available', project_id INTEGER, bom_item_id INTEGER
)`);
await run(`CREATE TABLE counters (name TEXT PRIMARY KEY, value INTEGER)`);

// ---- tracking-mode.js mirror ----
async function assertTrackingMode(inventoryItemId, mode) {
  const item = await one('SELECT tracking_mode FROM inventory_items WHERE id = ?', [inventoryItemId]);
  if (!item) throw new Error('Inventory item not found');
  if (item.tracking_mode === 'scalar') {
    await run('UPDATE inventory_items SET tracking_mode = ? WHERE id = ?', [mode, inventoryItemId]);
    return;
  }
  if (item.tracking_mode !== mode) throw new Error(`This inventory line is tracked as '${item.tracking_mode}', not '${mode}'`);
}
async function countTrackedChildren(inventoryItemId) {
  const [p, b, s] = await Promise.all([
    one('SELECT COUNT(*) AS n FROM stock_pieces WHERE inventory_item_id = ?', [inventoryItemId]),
    one('SELECT COUNT(*) AS n FROM inventory_batches WHERE inventory_item_id = ?', [inventoryItemId]),
    one('SELECT COUNT(*) AS n FROM inventory_serials WHERE inventory_item_id = ?', [inventoryItemId]),
  ]);
  return (p?.n || 0) + (b?.n || 0) + (s?.n || 0);
}
async function setTrackingMode(inventoryItemId, mode) {
  const existing = await countTrackedChildren(inventoryItemId);
  if (existing > 0) throw new Error("Can't change tracking mode — this line already has tracked stock");
  await run('UPDATE inventory_items SET tracking_mode = ? WHERE id = ?', [mode, inventoryItemId]);
}

// ---- stock-receipts.js mirror ----
let counter = 1000;
async function nextNumber(prefix) { counter++; return `${prefix}-${counter}`; }
async function createReceipt({ supplierId, poId, grnRef }) {
  const inwardBatchNo = await nextNumber('INW');
  const { lastInsertRowid } = await run(
    `INSERT INTO stock_receipts (inward_batch_no, supplier_id, po_id, grn_ref) VALUES (?, ?, ?, ?)`,
    [inwardBatchNo, supplierId || null, poId || null, grnRef || null]
  );
  return { id: Number(lastInsertRowid), inward_batch_no: inwardBatchNo };
}

// ---- receivePiece / cutPiece mirror (adds tracking_mode + receipt_id + pending_receipt) ----
function rootCode(kind, id) { return `${kind === 'plate' ? 'PL' : 'LN'}-${String(id).padStart(4, '0')}`; }
async function receivePiece({ inventoryItemId, kind, weight_kg, heat_no, test_certificate_id, receiptId }) {
  await assertTrackingMode(inventoryItemId, 'piece');
  const { lastInsertRowid } = await run(
    `INSERT INTO stock_pieces (inventory_item_id, kind, weight_kg, status, source, heat_no, test_certificate_id, receipt_id) VALUES (?, ?, ?, 'available', 'purchase', ?, ?, ?)`,
    [inventoryItemId, kind, weight_kg, heat_no || null, test_certificate_id || null, receiptId || null]
  );
  const id = Number(lastInsertRowid);
  const code = rootCode(kind, id);
  await run('UPDATE stock_pieces SET code = ? WHERE id = ?', [code, id]);
  return { id, code };
}
async function cutPiece({ sourcePieceId, used = [], remnants = [], projectId, bomItemId }) {
  const source = await one('SELECT * FROM stock_pieces WHERE id = ?', [sourcePieceId]);
  // Material Indent hard gate (2026-09-02): tightened to `status = 'reserved'` only — kept in
  // lockstep with the real lib/stock-pieces.js gate, same as scripts/remnant-cutting-selfcheck.mjs's
  // own mirror. Callers in this file now reserve a piece explicitly before cutting it (see below).
  const flip = await run("UPDATE stock_pieces SET status = 'consumed' WHERE id = ? AND status = 'reserved'", [sourcePieceId]);
  if (flip.rowsAffected !== 1) throw new Error('must be reserved first');
  let uIdx = 0, rIdx = 0;
  for (const u of used) {
    uIdx++;
    const ins = await run(
      `INSERT INTO stock_pieces (inventory_item_id, kind, weight_kg, status, source, parent_id, project_id, bom_item_id, heat_no, test_certificate_id) VALUES (?, ?, ?, 'consumed', 'remnant', ?, ?, ?, ?, ?)`,
      [source.inventory_item_id, source.kind, u.weight_kg, sourcePieceId, projectId || null, bomItemId || null, source.heat_no, source.test_certificate_id]
    );
    await run('UPDATE stock_pieces SET code = ? WHERE id = ?', [`${source.code}-U${uIdx}`, Number(ins.lastInsertRowid)]);
  }
  for (const r of remnants) {
    rIdx++;
    // pending_receipt, not available (18.4) — no receipt_id: a cut child inherits traceability by
    // copy (heat/cert), not via a receipt of its own.
    const ins = await run(
      `INSERT INTO stock_pieces (inventory_item_id, kind, weight_kg, status, source, parent_id, heat_no, test_certificate_id) VALUES (?, ?, ?, 'pending_receipt', 'remnant', ?, ?, ?)`,
      [source.inventory_item_id, source.kind, r.weight_kg, sourcePieceId, source.heat_no, source.test_certificate_id]
    );
    await run('UPDATE stock_pieces SET code = ? WHERE id = ?', [`${source.code}-R${rIdx}`, Number(ins.lastInsertRowid)]);
  }
  return { ok: true };
}
async function confirmPieceReceipt(pieceId) {
  const res = await run("UPDATE stock_pieces SET status = 'available' WHERE id = ? AND status = 'pending_receipt'", [pieceId]);
  if (res.rowsAffected !== 1) throw new Error('Piece is not pending receipt');
}
// Mirrors the auto-matcher / reservePiece's own candidate-pool filter — both simply read status.
async function findAvailablePieces(inventoryItemId) {
  return all("SELECT * FROM stock_pieces WHERE inventory_item_id = ? AND status = 'available'", [inventoryItemId]);
}

// ---- inventory-batches.js mirror ----
async function receiveBatch({ inventoryItemId, qty, heatNo, supplierBatchNo, testCertificateId, receiptId }) {
  await assertTrackingMode(inventoryItemId, 'batch');
  const { lastInsertRowid } = await run(
    `INSERT INTO inventory_batches (inventory_item_id, qty, heat_no, supplier_batch_no, test_certificate_id, receipt_id, status) VALUES (?, ?, ?, ?, ?, ?, 'available')`,
    [inventoryItemId, qty, heatNo || null, supplierBatchNo || null, testCertificateId || null, receiptId || null]
  );
  return { id: Number(lastInsertRowid) };
}

// ---- inventory-serials.js mirror ----
function serialCode(id) { return `SR-${String(id).padStart(4, '0')}`; }
async function receiveSerial({ inventoryItemId, serialNo, testCertificateId, receiptId }) {
  await assertTrackingMode(inventoryItemId, 'serial');
  const { lastInsertRowid } = await run(
    `INSERT INTO inventory_serials (inventory_item_id, serial_no, test_certificate_id, receipt_id, status) VALUES (?, ?, ?, ?, 'available')`,
    [inventoryItemId, serialNo || null, testCertificateId || null, receiptId || null]
  );
  const id = Number(lastInsertRowid);
  const code = serialCode(id);
  await run('UPDATE inventory_serials SET code = ? WHERE id = ?', [code, id]);
  return { id, code };
}

// =====================================================================================
// A2.1 — mode match: a line's tracking_mode must match the entity being received into it
// =====================================================================================
await run(`INSERT INTO inventory_items (id, description) VALUES (1, 'Bolt M20x80')`);
await run(`INSERT INTO inventory_items (id, description) VALUES (2, 'MS Plate 10mm')`);
await run(`INSERT INTO inventory_items (id, description) VALUES (3, 'Gate Valve 100NB')`);
{
  await receiveBatch({ inventoryItemId: 1, qty: 100, supplierBatchNo: 'SB-1' }); // adopts 'batch'
  await assert.rejects(() => receivePiece({ inventoryItemId: 1, kind: 'plate', weight_kg: 10 }), /tracked as 'batch'/, 'a batch-mode line must reject a piece receive');
  await assert.rejects(() => receiveSerial({ inventoryItemId: 1, serialNo: 'X' }), /tracked as 'batch'/, 'a batch-mode line must reject a serial receive');

  await receivePiece({ inventoryItemId: 2, kind: 'plate', weight_kg: 706.5 }); // adopts 'piece'
  await assert.rejects(() => receiveBatch({ inventoryItemId: 2, qty: 5 }), /tracked as 'piece'/, 'a piece-mode line must reject a batch receive');

  await receiveSerial({ inventoryItemId: 3, serialNo: 'MFR-SN-001' }); // adopts 'serial'
  await assert.rejects(() => receivePiece({ inventoryItemId: 3, kind: 'plate', weight_kg: 1 }), /tracked as 'serial'/, 'a serial-mode line must reject a piece receive');
}
console.log('tracking_mode match guard: ok (A2.1)');

// =====================================================================================
// A2.2 — mode immutable once any child row exists; free to set while zero exist
// =====================================================================================
{
  await assert.rejects(() => setTrackingMode(2, 'batch'), /already has tracked stock/, 'a line with an existing piece must reject a mode switch');
  await run(`INSERT INTO inventory_items (id, description) VALUES (4, 'Fresh line, nothing received yet')`);
  await assert.doesNotReject(() => setTrackingMode(4, 'serial'), 'a line with zero tracked children may freely set its mode');
}
console.log('tracking_mode immutability guard: ok (A2.2)');

// =====================================================================================
// A2.3 — receipt provenance: every newly received entity resolves back to its receipt's
// supplier/PO/inward-batch; a cut remnant has no receipt of its own
// =====================================================================================
{
  await run(`INSERT INTO suppliers (id, name) VALUES (1, 'ABC Steel')`);
  await run(`INSERT INTO purchase_orders (id, po_no) VALUES (1, '101/SB/2026-27')`);
  const receipt = await createReceipt({ supplierId: 1, poId: 1, grnRef: 'GRN-55' });
  assert.ok(receipt.inward_batch_no.startsWith('INW-'), 'inward batch no. must be ERP-generated');

  const piece = await receivePiece({ inventoryItemId: 2, kind: 'plate', weight_kg: 100, heat_no: 'H1', receiptId: receipt.id });
  const resolved = await one(
    `SELECT sr.inward_batch_no, sr.grn_ref, s.name AS supplier_name, po.po_no
       FROM stock_pieces sp JOIN stock_receipts sr ON sr.id = sp.receipt_id
       LEFT JOIN suppliers s ON s.id = sr.supplier_id LEFT JOIN purchase_orders po ON po.id = sr.po_id
      WHERE sp.id = ?`, [piece.id]
  );
  assert.strictEqual(resolved.supplier_name, 'ABC Steel', 'a received piece must resolve back to its supplier via receipt_id');
  assert.strictEqual(resolved.po_no, '101/SB/2026-27', 'a received piece must resolve back to its PO via receipt_id');
  assert.strictEqual(resolved.inward_batch_no, receipt.inward_batch_no, 'a received piece must resolve back to its inward batch no.');

  await run("UPDATE stock_pieces SET status = 'reserved' WHERE id = ?", [piece.id]); // Material Indent gate — must be reserved before cutPiece() will act
  await cutPiece({ sourcePieceId: piece.id, remnants: [{ weight_kg: 30 }] });
  const remnant = await one("SELECT receipt_id FROM stock_pieces WHERE parent_id = ? AND source = 'remnant'", [piece.id]);
  assert.strictEqual(remnant.receipt_id, null, 'a cut remnant must have no receipt of its own — it inherits traceability by copy, not via a new receipt link');
}
console.log('receipt provenance (piece -> receipt -> supplier/PO/inward-batch): ok (A2.3)');

// =====================================================================================
// A2.4 — header purity: stock_receipts carries only event-level data, never material-level
// =====================================================================================
{
  const cols = (await run('PRAGMA table_info(stock_receipts)')).rows.map(r => r.name);
  const forbidden = ['heat_no', 'qty', 'weight_kg', 'material_description', 'test_certificate_id', 'supplier_batch_no'];
  for (const f of forbidden) {
    assert.ok(!cols.includes(f), `stock_receipts must never carry a material-level column ('${f}' found)`);
  }
  assert.ok(cols.includes('supplier_id') && cols.includes('po_id') && cols.includes('inward_batch_no'), 'stock_receipts must carry its event-level identity fields');
}
console.log('receipt header purity (event-level only): ok (A2.4)');

// =====================================================================================
// A2.5 — remnant handoff: pending_receipt is excluded from the available pool until confirmed
// =====================================================================================
{
  const source = await receivePiece({ inventoryItemId: 2, kind: 'plate', weight_kg: 200 });
  await run("UPDATE stock_pieces SET status = 'reserved' WHERE id = ?", [source.id]); // Material Indent gate
  await cutPiece({ sourcePieceId: source.id, remnants: [{ weight_kg: 50 }] });
  const remnant = await one("SELECT * FROM stock_pieces WHERE parent_id = ? AND source = 'remnant'", [source.id]);
  assert.strictEqual(remnant.status, 'pending_receipt', 'a freshly cut remnant must start as pending_receipt, not available');

  let pool = await findAvailablePieces(2);
  assert.ok(!pool.some(p => p.id === remnant.id), 'a pending_receipt remnant must be absent from the available/matchable pool');

  await confirmPieceReceipt(remnant.id);
  const confirmed = await one('SELECT status FROM stock_pieces WHERE id = ?', [remnant.id]);
  assert.strictEqual(confirmed.status, 'available', 'confirming receipt must flip pending_receipt -> available');

  pool = await findAvailablePieces(2);
  assert.ok(pool.some(p => p.id === remnant.id), 'once confirmed, the remnant must now appear in the available/matchable pool');

  await assert.rejects(() => confirmPieceReceipt(remnant.id), /not pending receipt/, 'confirming an already-confirmed piece must reject (CAS), not double-count');
}
console.log('remnant physical-handoff (pending_receipt -> available): ok (A2.5)');

// =====================================================================================
// A2.6 — full traceability chain: receipt -> supplier/PO -> piece -> heat/cert -> cut children
// -> consumption (project/BOM), all resolvable by query alone
// =====================================================================================
{
  await run(`INSERT INTO test_certificates (id, certificate_no, cast_no, heat_no) VALUES (1, 'MTC-9001', 'C-500', 'H-500')`);
  await run(`INSERT INTO projects (id, project_no) VALUES (1, 'SB-2001')`);
  await run(`INSERT INTO bom_items (id, project_id, material_description) VALUES (1, 1, '20mm plate')`);
  await run(`INSERT INTO suppliers (id, name) VALUES (2, 'XYZ Mills')`);
  await run(`INSERT INTO purchase_orders (id, po_no) VALUES (2, '202/SB/2026-27')`);
  await run(`INSERT INTO inventory_items (id, description) VALUES (5, '25mm IS2062 Plate')`);

  const receipt = await createReceipt({ supplierId: 2, poId: 2, grnRef: 'GRN-99' });
  const root = await receivePiece({ inventoryItemId: 5, kind: 'plate', weight_kg: 245.31, heat_no: 'H-500', test_certificate_id: 1, receiptId: receipt.id });
  await run("UPDATE stock_pieces SET status = 'reserved' WHERE id = ?", [root.id]); // Material Indent gate
  await cutPiece({ sourcePieceId: root.id, used: [{ weight_kg: 157 }], remnants: [{ weight_kg: 73.18 }], projectId: 1, bomItemId: 1 });

  // Q3/Q4: which MTC certifies this piece, which heat/cast does it cover?
  const usedChild = await one("SELECT * FROM stock_pieces WHERE parent_id = ? AND status = 'consumed' AND source = 'remnant'", [root.id]);
  const cert = await one('SELECT * FROM test_certificates WHERE id = ?', [usedChild.test_certificate_id]);
  assert.strictEqual(cert.certificate_no, 'MTC-9001');
  assert.strictEqual(cert.heat_no, 'H-500');
  assert.strictEqual(cert.cast_no, 'C-500');

  // Q2/Q7: which BOM line consumed this piece, where was it ultimately consumed?
  const consumption = await one(
    `SELECT p.project_no, b.material_description FROM stock_pieces sp
       JOIN projects p ON p.id = sp.project_id JOIN bom_items b ON b.id = sp.bom_item_id
      WHERE sp.id = ?`, [usedChild.id]
  );
  assert.strictEqual(consumption.project_no, 'SB-2001');
  assert.strictEqual(consumption.material_description, '20mm plate');

  // Q5: which receipt (and therefore supplier/PO/inward batch) brought the ORIGINAL material in?
  const provenance = await one(
    `SELECT sr.inward_batch_no, s.name AS supplier_name, po.po_no FROM stock_pieces sp
       JOIN stock_receipts sr ON sr.id = sp.receipt_id
       LEFT JOIN suppliers s ON s.id = sr.supplier_id LEFT JOIN purchase_orders po ON po.id = sr.po_id
      WHERE sp.id = ?`, [root.id]
  );
  assert.strictEqual(provenance.supplier_name, 'XYZ Mills');
  assert.strictEqual(provenance.po_no, '202/SB/2026-27');

  // Q6: which other pieces came from the same certified material (same test_certificate_id)?
  const siblings = await all('SELECT id FROM stock_pieces WHERE test_certificate_id = 1');
  assert.ok(siblings.length >= 2, 'the root and its used child must both resolve to the same certificate');
}
console.log('full traceability chain (receipt -> supplier/PO -> heat/MTC -> consumption): ok (A2.6)');

console.log('\nAll Phase 2 tracking-model self-checks passed.');
