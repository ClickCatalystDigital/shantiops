// scripts/inventory-reservations-selfcheck.mjs — runnable check for Phase 6.3's reserve/available
// inventory model (V2-CHANGES.md Group 6). Same precedent as advance-status-selfcheck.mjs: an
// in-memory libsql DB with synthetic fixtures, and the logic below is a deliberate hand-copy of
// lib/procurement.js's reserveFromStock/issueReservation/releaseReservation (that file is
// ESM-syntax `.js`, only loadable through Next's bundler — a self-check can't import it directly).
// Covers the exact case this phase exists for: two requests can never draw the same physical units.
//   node scripts/inventory-reservations-selfcheck.mjs
import assert from 'node:assert';
import { createClient } from '@libsql/client';

const db = createClient({ url: ':memory:' });
async function run(sql, args = []) { return db.execute({ sql, args }); }

await run(`CREATE TABLE projects (id INTEGER PRIMARY KEY, project_no TEXT, status TEXT DEFAULT 'active')`);
await run(`CREATE TABLE bom_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER, material_description TEXT, moc TEXT,
  size_spec TEXT, section TEXT, qty_text TEXT, purchase_status TEXT, source TEXT DEFAULT 'bom',
  sale_order_no TEXT, sort_order INTEGER DEFAULT 0, inventory_item_id INTEGER, inventory_qty REAL
)`);
await run(`CREATE TABLE inventory_items (id INTEGER PRIMARY KEY AUTOINCREMENT, description TEXT, on_hand REAL DEFAULT 0)`);
await run(`CREATE TABLE inventory_reservations (
  id INTEGER PRIMARY KEY AUTOINCREMENT, inventory_item_id INTEGER, bom_item_id INTEGER, qty REAL,
  status TEXT DEFAULT 'active', created_by TEXT, issued_at TEXT, released_at TEXT
)`);

function splitQtyText(qtyText, qtyA, qtyB) {
  const m = String(qtyText || '').match(/^\s*(\d+(?:\.\d+)?)\s*(.*)$/);
  const suffix = m ? m[2].trim() : '';
  return [suffix ? `${qtyA} ${suffix}` : `${qtyA}`, suffix ? `${qtyB} ${suffix}` : `${qtyB}`];
}

async function reserveFromStock({ inventoryItemId, bomItemId, qty }) {
  const { rows: [invItem] } = await run('SELECT * FROM inventory_items WHERE id = ?', [inventoryItemId]);
  const { rows: [bomItem] } = await run('SELECT * FROM bom_items WHERE id = ?', [bomItemId]);
  const { rows: [{ reserved }] } = await run(
    `SELECT COALESCE(SUM(qty), 0) AS reserved FROM inventory_reservations WHERE inventory_item_id = ? AND status = 'active'`,
    [inventoryItemId]);
  const available = invItem.on_hand - reserved;
  const requested = Number(qty);
  if (!(requested > 0)) throw new Error('Quantity must be greater than zero');
  const reserveQty = Math.min(requested, available);
  if (reserveQty <= 0) throw new Error('Nothing available to reserve');
  const shortfall = requested - reserveQty;

  let targetBomItemId = bomItemId;
  if (shortfall > 0) {
    const [remainingQtyText, reservedQtyText] = splitQtyText(bomItem.qty_text, shortfall, reserveQty);
    await run('UPDATE bom_items SET qty_text = ? WHERE id = ?', [remainingQtyText, bomItemId]);
    const ins = await run(
      `INSERT INTO bom_items (project_id, material_description, moc, size_spec, section, qty_text, purchase_status, source, sale_order_no, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [bomItem.project_id, bomItem.material_description, bomItem.moc, bomItem.size_spec, bomItem.section,
        reservedQtyText, bomItem.purchase_status, bomItem.source, bomItem.sale_order_no, bomItem.sort_order]);
    targetBomItemId = Number(ins.lastInsertRowid);
  }
  const ins = await run(
    `INSERT INTO inventory_reservations (inventory_item_id, bom_item_id, qty, status) VALUES (?, ?, ?, 'active')`,
    [inventoryItemId, targetBomItemId, reserveQty]);
  return { reservationId: Number(ins.lastInsertRowid), reservedQty: reserveQty, shortfall, bomItemId: targetBomItemId };
}

async function issueReservation(reservationId) {
  const { rows: [res] } = await run('SELECT * FROM inventory_reservations WHERE id = ?', [reservationId]);
  if (res.status !== 'active') throw new Error(`Reservation already ${res.status}`);
  await run("UPDATE inventory_reservations SET status = 'issued' WHERE id = ?", [reservationId]);
  await run('UPDATE inventory_items SET on_hand = on_hand - ? WHERE id = ?', [res.qty, res.inventory_item_id]);
  await run("UPDATE bom_items SET purchase_status = 'In-Stock', inventory_item_id = ?, inventory_qty = ? WHERE id = ?",
    [res.inventory_item_id, res.qty, res.bom_item_id]);
  return res;
}

async function releaseReservation(reservationId) {
  const { rows: [res] } = await run('SELECT * FROM inventory_reservations WHERE id = ?', [reservationId]);
  if (res.status !== 'active') return res;
  await run("UPDATE inventory_reservations SET status = 'released' WHERE id = ?", [reservationId]);
  return res;
}

async function available(inventoryItemId) {
  const { rows: [{ on_hand }] } = await run('SELECT on_hand FROM inventory_items WHERE id = ?', [inventoryItemId]);
  const { rows: [{ reserved }] } = await run(
    `SELECT COALESCE(SUM(qty), 0) AS reserved FROM inventory_reservations WHERE inventory_item_id = ? AND status = 'active'`,
    [inventoryItemId]);
  return on_hand - reserved;
}

await run(`INSERT INTO projects (id, project_no) VALUES (1, 'SB-TEST')`);

// --- Case 1: full reserve, no shortfall, no split. ---
await run(`INSERT INTO inventory_items (id, description, on_hand) VALUES (1, 'MS ANGLE', 10)`);
await run(`INSERT INTO bom_items (id, project_id, material_description, qty_text, purchase_status) VALUES (10, 1, 'MS ANGLE', '3 Nos', 'Enquiry')`);
const r1 = await reserveFromStock({ inventoryItemId: 1, bomItemId: 10, qty: 3 });
assert.strictEqual(r1.shortfall, 0, 'full reserve: no shortfall');
assert.strictEqual(r1.bomItemId, 10, 'full reserve: no split, points at original row');
assert.strictEqual(await available(1), 7, 'available drops by reserved qty, on_hand untouched');
const { rows: [{ on_hand: onHandAfterReserve }] } = await run('SELECT on_hand FROM inventory_items WHERE id = 1');
assert.strictEqual(onHandAfterReserve, 10, 'on_hand must not move on Reserve alone');

// --- Case 2: the exclusivity case the client flagged — a second request cannot draw the same units. ---
await run(`INSERT INTO bom_items (id, project_id, material_description, qty_text, source, sale_order_no, purchase_status) VALUES (11, 1, 'MS ANGLE', '7 Nos', 'sas', 'SO-1', 'Enquiry')`);
const r2 = await reserveFromStock({ inventoryItemId: 1, bomItemId: 11, qty: 7 });
assert.strictEqual(r2.reservedQty, 7, 'second request reserves exactly what remains available (7)');
assert.strictEqual(await available(1), 0, 'available now fully committed');
await assert.rejects(() => reserveFromStock({ inventoryItemId: 1, bomItemId: 11, qty: 1 }),
  /Nothing available to reserve/, 'a third reserve attempt against the same exhausted stock must fail');

// --- Case 3: Issue actually moves on_hand and sets In-Stock; a released reservation frees available. ---
await issueReservation(r1.reservationId);
const { rows: [{ on_hand: onHandAfterIssue }] } = await run('SELECT on_hand FROM inventory_items WHERE id = 1');
assert.strictEqual(onHandAfterIssue, 7, 'Issue decrements on_hand by the reserved qty');
const { rows: [bomAfterIssue] } = await run('SELECT purchase_status, inventory_item_id, inventory_qty FROM bom_items WHERE id = 10');
assert.strictEqual(bomAfterIssue.purchase_status, 'In-Stock', 'Issue sets the bom_item terminal In-Stock');
assert.strictEqual(bomAfterIssue.inventory_qty, 3, 'Issue stamps the qty actually taken');

await releaseReservation(r2.reservationId);
assert.strictEqual(await available(1), 7, 'Release frees the qty back into available (on_hand unaffected by release)');
const { rows: [{ on_hand: onHandAfterRelease }] } = await run('SELECT on_hand FROM inventory_items WHERE id = 1');
assert.strictEqual(onHandAfterRelease, 7, 'Release must never touch on_hand');

// --- Case 4: partial fulfilment splits the row — original keeps procuring the shortfall. ---
await run(`INSERT INTO inventory_items (id, description, on_hand) VALUES (2, 'GLOBE VALVE', 2)`);
await run(`INSERT INTO bom_items (id, project_id, material_description, qty_text, purchase_status) VALUES (12, 1, 'GLOBE VALVE', '5 Nos', 'Enquiry')`);
const r4 = await reserveFromStock({ inventoryItemId: 2, bomItemId: 12, qty: 5 });
assert.strictEqual(r4.reservedQty, 2, 'partial: reserves only what is available');
assert.strictEqual(r4.shortfall, 3, 'partial: shortfall reported correctly');
assert.notStrictEqual(r4.bomItemId, 12, 'partial: reservation points at a NEW cloned row, not the original');
const { rows: [originalAfterSplit] } = await run('SELECT qty_text, purchase_status FROM bom_items WHERE id = 12');
assert.strictEqual(originalAfterSplit.qty_text, '3 Nos', 'original row trimmed to the shortfall, unit text preserved');
assert.strictEqual(originalAfterSplit.purchase_status, 'Enquiry', 'original row keeps procuring, status untouched');
const { rows: [clonedRow] } = await run('SELECT qty_text, project_id FROM bom_items WHERE id = ?', [r4.bomItemId]);
assert.strictEqual(clonedRow.qty_text, '2 Nos', 'cloned row carries the reserved qty with unit text preserved');
assert.strictEqual(clonedRow.project_id, 1, 'cloned row keeps the same project as the original');

// --- Case 5: idempotency guard for the Received -> on_hand increment (mirrors the PATCH route's check). ---
await run(`INSERT INTO inventory_items (id, description, on_hand) VALUES (3, 'STOCK BUILD ITEM', 0)`);
await run(`INSERT INTO bom_items (id, project_id, material_description, qty_text, purchase_status, source, inventory_item_id, inventory_qty)
           VALUES (20, 1, 'BUILD ITEM', '4 Nos', 'Transit', 'stock', 3, 4)`);
async function receivedIncrementHook(bomItemId, priorStatus, newStatus) {
  const { rows: [item] } = await run('SELECT * FROM bom_items WHERE id = ?', [bomItemId]);
  if (item.source === 'stock' && priorStatus !== 'Received' && newStatus === 'Received' && item.inventory_item_id && item.inventory_qty) {
    await run('UPDATE inventory_items SET on_hand = on_hand + ? WHERE id = ?', [item.inventory_qty, item.inventory_item_id]);
  }
  await run('UPDATE bom_items SET purchase_status = ? WHERE id = ?', [newStatus, bomItemId]);
}
await receivedIncrementHook(20, 'Transit', 'Received');
let { rows: [{ on_hand: buildOnHand }] } = await run('SELECT on_hand FROM inventory_items WHERE id = 3');
assert.strictEqual(buildOnHand, 4, 'first transition to Received increments on_hand by the captured qty');
await receivedIncrementHook(20, 'Received', 'Received'); // re-save, same status both sides
({ rows: [{ on_hand: buildOnHand }] } = await run('SELECT on_hand FROM inventory_items WHERE id = 3'));
assert.strictEqual(buildOnHand, 4, 'a re-save of an already-Received row must not double-increment');

// --- Case 6: found live post-ship — the Status tab's manual override can set purchase_status
// straight to 'Cancelled', bypassing the dedicated /cancel route (Eng/Design only) where the
// reservation-release call originally lived. Mirrors the fix in app/api/bom-items/[id]/route.js. ---
await run(`INSERT INTO inventory_items (id, description, on_hand) VALUES (4, 'MANUAL CANCEL STOCK', 10)`);
await run(`INSERT INTO bom_items (id, project_id, material_description, qty_text, purchase_status) VALUES (30, 1, 'MANUAL CANCEL ITEM', '1 No', 'Enquiry')`);
const r6 = await reserveFromStock({ inventoryItemId: 4, bomItemId: 30, qty: 1 });
assert.strictEqual(await available(4), 9, 'reservation committed before the manual cancel');
async function manualPatchHook(bomItemId, priorStatus, newStatus) {
  if (priorStatus !== 'Cancelled' && newStatus === 'Cancelled') {
    const active = await run("SELECT id FROM inventory_reservations WHERE bom_item_id = ? AND status = 'active'", [bomItemId]);
    for (const row of active.rows) await releaseReservation(row.id);
  }
  await run('UPDATE bom_items SET purchase_status = ? WHERE id = ?', [newStatus, bomItemId]);
}
await manualPatchHook(30, 'Enquiry', 'Cancelled');
assert.strictEqual(await available(4), 10, 'manually cancelling via the Status-tab route must also release the reservation');
const { rows: [releasedRow] } = await run('SELECT status FROM inventory_reservations WHERE id = ?', [r6.reservationId]);
assert.strictEqual(releasedRow.status, 'released', 'the reservation itself is marked released, not left active');

// --- Case 7: found live post-ship — inventory_reservations.bom_item_id has no ON DELETE clause,
// and a *released* (not just active) reservation still references the row, so deleting a bom_item
// with any reservation history at all (regardless of status) must be blocked, not attempted. ---
async function canDeleteBomItem(bomItemId) {
  const { rows: [{ n }] } = await run('SELECT COUNT(*) AS n FROM inventory_reservations WHERE bom_item_id = ?', [bomItemId]);
  return n === 0;
}
assert.strictEqual(await canDeleteBomItem(30), false, 'a bom_item with a released (not active) reservation must still be blocked from deletion');
await run(`INSERT INTO bom_items (id, project_id, material_description, qty_text, purchase_status) VALUES (31, 1, 'NEVER RESERVED ITEM', '1 No', 'Enquiry')`);
assert.strictEqual(await canDeleteBomItem(31), true, 'a bom_item with no reservation history at all is deletable');

// --- Case 8: found live post-ship — issueReservation unconditionally sets purchase_status =
// 'In-Stock', so reserving against an already-terminal item (Received/Cancelled/In-Stock) and then
// issuing it would silently resurrect/overwrite a resolved item's real status. Mirrors the fix in
// lib/procurement.js's reserveFromStock (isClosedStatus guard, same lesson Phase 5.1's
// advancePurchaseStatus already learned once for a different write path). ---
const CLOSED = new Set(['Received', 'Cancelled', 'In-Stock']);
await run(`INSERT INTO inventory_items (id, description, on_hand) VALUES (5, 'GUARD TEST STOCK', 5)`);
await run(`INSERT INTO bom_items (id, project_id, material_description, qty_text, purchase_status) VALUES (40, 1, 'ALREADY RECEIVED ITEM', '1 No', 'Received')`);
async function guardedReserve(inventoryItemId, bomItemId, qty) {
  const { rows: [item] } = await run('SELECT * FROM bom_items WHERE id = ?', [bomItemId]);
  if (CLOSED.has(item.purchase_status)) throw new Error(`Can't reserve — already ${item.purchase_status}`);
  return reserveFromStock({ inventoryItemId, bomItemId, qty });
}
await assert.rejects(() => guardedReserve(5, 40, 1), /Can't reserve — already Received/,
  'reserving against an already-Received item must be rejected, not silently allowed through to a resurrecting Issue');

console.log('inventory-reservations-selfcheck: all assertions passed');
