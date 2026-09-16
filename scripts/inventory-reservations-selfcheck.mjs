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
  qty_issued REAL NOT NULL DEFAULT 0, status TEXT DEFAULT 'active', created_by TEXT, issued_at TEXT,
  released_at TEXT
)`);
await run(`CREATE TABLE material_issues (
  id INTEGER PRIMARY KEY AUTOINCREMENT, bom_item_id INTEGER, qty REAL
)`);

function splitQtyText(qtyText, qtyA, qtyB) {
  const m = String(qtyText || '').match(/^\s*(\d+(?:\.\d+)?)\s*(.*)$/);
  const suffix = m ? m[2].trim() : '';
  return [suffix ? `${qtyA} ${suffix}` : `${qtyA}`, suffix ? `${qtyB} ${suffix}` : `${qtyB}`];
}

async function reserveFromStock({ inventoryItemId, bomItemId, qty }) {
  const { rows: [invItem] } = await run('SELECT * FROM inventory_items WHERE id = ?', [inventoryItemId]);
  const { rows: [bomItem] } = await run('SELECT * FROM bom_items WHERE id = ?', [bomItemId]);
  // Reservation/Issue reconciliation fix — qty - qty_issued, mirrors the real fix in
  // lib/procurement.js's reserveFromStock: an already-issued portion of some OTHER row already left
  // on_hand and must not also still be subtracted here.
  const { rows: [{ reserved }] } = await run(
    `SELECT COALESCE(SUM(qty - qty_issued), 0) AS reserved FROM inventory_reservations WHERE inventory_item_id = ? AND status = 'active'`,
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

// Reservation/Issue reconciliation fix — mirrors the real lib/procurement.js::issueReservation():
// a row may already have been partially drawn down by consumeReservedStock before this runs, so
// this issues whatever is still outstanding (remaining), never the row's original full qty a
// second time. CAS-guarded the same way the real function is.
async function issueReservation(reservationId) {
  const { rows: [res] } = await run('SELECT * FROM inventory_reservations WHERE id = ?', [reservationId]);
  if (res.status !== 'active') throw new Error(`Reservation already ${res.status}`);
  const remaining = res.qty - res.qty_issued;
  if (!(remaining > 0)) throw new Error('Reservation already fully issued');
  const claim = await run(
    `UPDATE inventory_reservations SET qty_issued = qty, status = 'issued', issued_at = 'now'
      WHERE id = ? AND status = 'active' AND qty_issued = ?`,
    [reservationId, res.qty_issued]);
  if (claim.rowsAffected !== 1) throw new Error('Reservation changed concurrently — reload and try again');
  await run('UPDATE inventory_items SET on_hand = on_hand - ? WHERE id = ?', [remaining, res.inventory_item_id]);
  await run("UPDATE bom_items SET purchase_status = 'In-Stock', inventory_item_id = ?, inventory_qty = ? WHERE id = ?",
    [res.inventory_item_id, remaining, res.bom_item_id]);
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
    `SELECT COALESCE(SUM(qty - qty_issued), 0) AS reserved FROM inventory_reservations WHERE inventory_item_id = ? AND status = 'active'`,
    [inventoryItemId]);
  return on_hand - reserved;
}

// consumeReservedStock — exact hand-mirror of the new lib/procurement.js::consumeReservedStock.
// Claims a single bom_item's own active reservations only, oldest row first, CAS-guarded per row,
// supports partial consumption, returns { consumed, shortfall }.
async function consumeReservedStock({ bomItemId, qty }) {
  let remaining = Number(qty);
  if (!(remaining > 0)) return { consumed: 0, shortfall: 0 };
  const { rows } = await run(
    `SELECT id, qty, qty_issued FROM inventory_reservations
      WHERE bom_item_id = ? AND status = 'active' AND qty > qty_issued
      ORDER BY id ASC`,
    [bomItemId]);
  let consumed = 0;
  for (const r of rows) {
    if (remaining <= 0) break;
    const rowRemaining = r.qty - r.qty_issued;
    if (!(rowRemaining > 0)) continue;
    const claim = Math.min(remaining, rowRemaining);
    const res = await run(
      `UPDATE inventory_reservations
          SET qty_issued = qty_issued + ?,
              status = CASE WHEN qty_issued + ? >= qty THEN 'issued' ELSE 'active' END
        WHERE id = ? AND status = 'active' AND qty_issued = ? AND qty_issued + ? <= qty`,
      [claim, claim, r.id, r.qty_issued, claim]);
    if (res.rowsAffected === 1) { consumed += claim; remaining -= claim; }
  }
  return { consumed, shortfall: Math.max(0, remaining) };
}

// issueMaterialScalar — exact hand-mirror of lib/material-issues.js::issueMaterial()'s scalar
// branch as changed by the Reservation/Issue reconciliation fix: consume this bom_item's own
// reservation first, only floor-check the general pool for any shortfall, decrement on_hand exactly
// once for the total, never touch bom_items.purchase_status.
async function issueMaterialScalar({ bomItemId, inventoryItemId, qty }) {
  const { consumed, shortfall } = await consumeReservedStock({ bomItemId, qty });
  if (shortfall > 0) {
    const { rows: [invItem] } = await run('SELECT on_hand FROM inventory_items WHERE id = ?', [inventoryItemId]);
    const { rows: [{ reserved }] } = await run(
      `SELECT COALESCE(SUM(qty - qty_issued), 0) AS reserved FROM inventory_reservations WHERE inventory_item_id = ? AND status = 'active'`,
      [inventoryItemId]);
    const avail = invItem.on_hand - reserved;
    if (avail < shortfall) throw new Error(`Insufficient stock — only ${avail} available`);
  }
  const ins = await run('INSERT INTO material_issues (bom_item_id, qty) VALUES (?, ?)', [bomItemId, qty]);
  await run('UPDATE inventory_items SET on_hand = on_hand - ? WHERE id = ?', [qty, inventoryItemId]);
  return { id: Number(ins.lastInsertRowid), consumedFromOwnReservation: consumed };
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

// --- Case 9: the confirmed self-block bug, now fixed. A bom_item's own reservation (created e.g.
// by an auto-reserve-at-receipt) must not block that same bom_item's Material Indent Issue. ---
await run(`INSERT INTO inventory_items (id, description, on_hand) VALUES (6, 'SELF-BLOCK TEST STOCK', 50)`);
await run(`INSERT INTO bom_items (id, project_id, material_description, qty_text, purchase_status) VALUES (50, 1, 'SELF-BLOCK ITEM', '50 Nos', 'Received')`);
const r9 = await reserveFromStock({ inventoryItemId: 6, bomItemId: 50, qty: 50 });
assert.strictEqual(r9.shortfall, 0, 'self-block setup: full auto-reserve at receipt, no shortfall');
const issue9 = await issueMaterialScalar({ bomItemId: 50, inventoryItemId: 6, qty: 50 });
assert.strictEqual(issue9.consumedFromOwnReservation, 50, 'Issue draws the full qty from the bom_item\'s own reservation, not the general pool');
const { rows: [res9] } = await run('SELECT status, qty_issued FROM inventory_reservations WHERE id = ?', [r9.reservationId]);
assert.strictEqual(res9.status, 'issued', 'fully-consumed reservation flips to issued');
assert.strictEqual(res9.qty_issued, 50, 'qty_issued equals the full original qty');
const { rows: [{ on_hand: onHand9 }] } = await run('SELECT on_hand FROM inventory_items WHERE id = 6');
assert.strictEqual(onHand9, 0, 'on_hand decremented by exactly the total issued qty, once');

// --- Case 10: partial issue leaves the reservation active with the correct remaining amount, and a
// second, later release correctly consumes the rest — no double-consumption. ---
await run(`INSERT INTO inventory_items (id, description, on_hand) VALUES (7, 'PARTIAL ISSUE STOCK', 20)`);
await run(`INSERT INTO bom_items (id, project_id, material_description, qty_text, purchase_status) VALUES (51, 1, 'PARTIAL ISSUE ITEM', '20 Nos', 'Received')`);
const r10 = await reserveFromStock({ inventoryItemId: 7, bomItemId: 51, qty: 20 });
await issueMaterialScalar({ bomItemId: 51, inventoryItemId: 7, qty: 12 });
const { rows: [res10a] } = await run('SELECT qty, status, qty_issued FROM inventory_reservations WHERE id = ?', [r10.reservationId]);
assert.strictEqual(res10a.status, 'active', 'a partial issue leaves the reservation active');
assert.strictEqual(res10a.qty_issued, 12, 'qty_issued reflects only what was actually issued so far');
assert.strictEqual(res10a.qty - res10a.qty_issued, 8, 'remaining is qty - qty_issued');
const issue10b = await issueMaterialScalar({ bomItemId: 51, inventoryItemId: 7, qty: 8 });
assert.strictEqual(issue10b.consumedFromOwnReservation, 8, 'the second release correctly consumes exactly the remainder');
const { rows: [res10b] } = await run('SELECT status, qty_issued FROM inventory_reservations WHERE id = ?', [r10.reservationId]);
assert.strictEqual(res10b.status, 'issued', 'fully consumed after the second release');
assert.strictEqual(res10b.qty_issued, 20, 'no double-consumption — qty_issued caps at the original qty');
const { rows: [{ on_hand: onHand10 }] } = await run('SELECT on_hand FROM inventory_items WHERE id = 7');
assert.strictEqual(onHand10, 0, 'on_hand decremented by 12 then 8, totalling exactly 20');

// --- Case 11: two reservation rows for the same bom_item (e.g. two partial receipts), consumed
// oldest-first, splitting the second row only for whatever the first couldn't cover. ---
await run(`INSERT INTO inventory_items (id, description, on_hand) VALUES (8, 'MULTI-ROW STOCK', 30)`);
await run(`INSERT INTO bom_items (id, project_id, material_description, qty_text, purchase_status) VALUES (52, 1, 'MULTI-ROW ITEM', '30 Nos', 'Received')`);
const r11a = await reserveFromStock({ inventoryItemId: 8, bomItemId: 52, qty: 10 }); // first receipt's own reservation
const r11b = await reserveFromStock({ inventoryItemId: 8, bomItemId: 52, qty: 20 }); // second receipt's own reservation
const issue11 = await issueMaterialScalar({ bomItemId: 52, inventoryItemId: 8, qty: 15 });
assert.strictEqual(issue11.consumedFromOwnReservation, 15, 'consumes across both rows to cover the full request');
const { rows: [row11a] } = await run('SELECT status, qty_issued FROM inventory_reservations WHERE id = ?', [r11a.reservationId]);
assert.strictEqual(row11a.status, 'issued', 'the OLDER row is fully consumed first');
assert.strictEqual(row11a.qty_issued, 10, 'older row consumed in full (its own qty)');
const { rows: [row11b] } = await run('SELECT status, qty_issued FROM inventory_reservations WHERE id = ?', [r11b.reservationId]);
assert.strictEqual(row11b.status, 'active', 'the newer row only partially consumed, stays active');
assert.strictEqual(row11b.qty_issued, 5, 'newer row absorbs exactly the remainder (15 - 10)');

// --- Case 12: a DIFFERENT bom_item's reservation must still protect its own stock from being
// consumed by an unrelated Issue — the Round-1 protection this fix must not reopen. ---
await run(`INSERT INTO inventory_items (id, description, on_hand) VALUES (9, 'CROSS-PROTECT STOCK', 10)`);
await run(`INSERT INTO bom_items (id, project_id, material_description, qty_text, purchase_status) VALUES (53, 1, 'OTHER ITEM RESERVED', '10 Nos', 'Received')`);
await run(`INSERT INTO bom_items (id, project_id, material_description, qty_text, purchase_status) VALUES (54, 1, 'UNRELATED ISSUE ATTEMPT', '5 Nos', 'Received')`);
await reserveFromStock({ inventoryItemId: 9, bomItemId: 53, qty: 10 }); // all 10 committed to item 53
await assert.rejects(
  () => issueMaterialScalar({ bomItemId: 54, inventoryItemId: 9, qty: 5 }),
  /Insufficient stock — only 0 available/,
  'item 54 has no reservation of its own and must not be able to draw on item 53\'s reserved stock');

// --- Case 13: issueReservation() on a row already partially consumed by a Material Indent release
// must only issue the remaining amount, never the row's original full qty a second time. ---
await run(`INSERT INTO inventory_items (id, description, on_hand) VALUES (10, 'BUTTON-ISSUE STOCK', 9)`);
await run(`INSERT INTO bom_items (id, project_id, material_description, qty_text, purchase_status) VALUES (55, 1, 'BUTTON-ISSUE ITEM', '9 Nos', 'Received')`);
const r13 = await reserveFromStock({ inventoryItemId: 10, bomItemId: 55, qty: 9 });
await consumeReservedStock({ bomItemId: 55, qty: 4 }); // simulates a Material Indent release for 4
const { rows: [{ on_hand: onHand13a }] } = await run('SELECT on_hand FROM inventory_items WHERE id = 10');
assert.strictEqual(onHand13a, 9, 'consumeReservedStock alone never touches on_hand — that is the caller\'s job');
await issueReservation(r13.reservationId); // Stores clicks "Issue" on the leftover via the button
const { rows: [{ on_hand: onHand13b }] } = await run('SELECT on_hand FROM inventory_items WHERE id = 10');
assert.strictEqual(onHand13b, 4, 'issueReservation decrements on_hand by the REMAINING 5, not the original 9 — no double count');
const { rows: [res13] } = await run('SELECT status, qty_issued FROM inventory_reservations WHERE id = ?', [r13.reservationId]);
assert.strictEqual(res13.status, 'issued', 'fully issued after the button click covers the remainder');
assert.strictEqual(res13.qty_issued, 9, 'qty_issued reaches the original full qty across both actions');

console.log('inventory-reservations-selfcheck: all assertions passed');
