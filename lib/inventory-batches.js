// lib/inventory-batches.js — Inventory Identity & Traceability, Phase 2 (receipt) + Phase 3
// (consumption, 2026-08-26). The bulk/consumable sibling to lib/stock-pieces.js's dimensional
// model: bolts, gaskets, electrodes, paint — material where the BATCH (a supplier's lot, an ERP
// inward batch) is the atomic traceability unit, never a per-unit serial or a cut/split lineage.
// `qty` is a decrementing pool, same idiom inventory_reservations already uses for scalar stock —
// not a count of rows.
import { execute, queryOne, queryAll } from './db';
import { assertTrackingMode } from './tracking-mode';

function round2(n) { return Math.round(n * 100) / 100; }

// tx-aware run/one: cutPiece()'s tx.execute({sql,args}) returns a different shape
// (rowsAffected/lastInsertRowid) than this file's own execute()/queryOne() (changes/lastId, rows
// directly). Normalizing here lets every function below work identically standalone or inside the
// larger withTransaction() block Phase 3's consumeStock() needs (lib/consume-stock.js).
async function run(tx, sql, args) {
  if (tx) {
    const r = await tx.execute({ sql, args });
    return { changes: Number(r.rowsAffected), lastId: r.lastInsertRowid != null ? Number(r.lastInsertRowid) : undefined };
  }
  return execute(sql, args);
}
async function one(tx, sql, args) {
  if (tx) return (await tx.execute({ sql, args })).rows[0];
  return queryOne(sql, args);
}

async function rollUpOnHand(inventoryItemId, tx) {
  const row = await one(tx, "SELECT COALESCE(SUM(qty), 0) AS n FROM inventory_batches WHERE inventory_item_id = ? AND status = 'available'", [inventoryItemId]);
  await run(tx, 'UPDATE inventory_items SET on_hand = ? WHERE id = ?', [row?.n || 0, inventoryItemId]);
}

// bomItemId (optional) — same presence-only gate receivePiece() uses (design Part 11/18.2): a
// non-empty heat/supplier-batch, or an existing test_certificates row for MTC. No cross-validation
// that the cert's content actually matches this batch — that stays an explicitly deferred, separate
// QC concern (§19.3), not silently assumed here.
export async function receiveBatch({ inventoryItemId, qty, heatNo, supplierBatchNo, testCertificateId, receiptId, bomItemId, username }) {
  await assertTrackingMode(inventoryItemId, 'batch');
  if (testCertificateId) {
    const cert = await queryOne('SELECT id FROM test_certificates WHERE id = ?', [testCertificateId]);
    if (!cert) throw new Error('Test certificate not found');
  }
  if (bomItemId) {
    const bomItem = await queryOne(
      'SELECT requires_heat_no, requires_mtc, requires_supplier_batch FROM bom_items WHERE id = ?', [bomItemId]);
    if (bomItem?.requires_heat_no && !String(heatNo || '').trim()) {
      throw new Error('This requirement needs a heat number before it can be received');
    }
    if (bomItem?.requires_mtc && !testCertificateId) {
      throw new Error('This requirement needs an MTC/certificate before it can be received');
    }
    if (bomItem?.requires_supplier_batch && !String(supplierBatchNo || '').trim()) {
      throw new Error('This requirement needs a supplier batch number before it can be received');
    }
  }
  const q = Number(qty);
  if (!(q > 0)) throw new Error('Enter a valid quantity');

  const { lastId } = await execute(
    `INSERT INTO inventory_batches (inventory_item_id, qty, heat_no, supplier_batch_no, test_certificate_id, receipt_id, status, created_by)
     VALUES (?, ?, ?, ?, ?, ?, 'available', ?)`,
    [inventoryItemId, q, heatNo || null, supplierBatchNo || null, testCertificateId || null, receiptId || null, username || null]
  );
  await rollUpOnHand(inventoryItemId);
  return { id: Number(lastId) };
}

// Issuing reduces the pool rather than materializing per-unit rows (design Part 8b: 100 bolts
// received, 35 consumed -> 65 remain as a number, never 65 fake serialized objects).
//
// Phase 3 CAS fix (2026-08-26, I10): the decrement now happens INSIDE the UPDATE's own
// `WHERE qty >= ?` guard, not as a read-then-compute-then-write. The earlier version read
// `batch.qty`, computed the remainder in JS, and wrote it back unconditionally — two concurrent
// 60-unit issues against one 100-unit batch could both read 100, both compute 40, and both write
// 40, silently over-consuming by 60 units. Same class of race Phase 0 already fixed once for
// cutPiece(); reintroduced here because this function predated that lesson. `rowsAffected !== 1`
// now means "someone else already consumed enough that this can't be satisfied" and throws instead
// of ever computing a wrong number.
export async function issueBatch(batchId, qty, tx) {
  const q = Number(qty);
  if (!(q > 0)) throw new Error('Quantity must be greater than zero');
  const flip = await run(tx,
    `UPDATE inventory_batches
        SET qty = round(qty - ?, 2),
            status = CASE WHEN qty - ? <= 0.0001 THEN 'consumed' ELSE 'available' END
      WHERE id = ? AND qty >= ? - 0.0001`,
    [q, q, batchId, q]
  );
  if (flip.changes !== 1) {
    const batch = await one(tx, 'SELECT qty FROM inventory_batches WHERE id = ?', [batchId]);
    if (!batch) throw new Error('Batch not found');
    throw new Error(`Only ${batch.qty} available in this batch`);
  }
  const batch = await one(tx, 'SELECT inventory_item_id, qty FROM inventory_batches WHERE id = ?', [batchId]);
  await rollUpOnHand(batch.inventory_item_id, tx);
  return { remaining: round2(batch.qty) };
}

// FIFO candidates for allocation (Phase 3) — oldest receipt first, the uncontroversial warehouse
// default; no picking-strategy UI needed. "Available for allocation" = qty minus whatever's already
// promised to an active (not yet issued/released) allocation — the same computed-not-stored idiom
// inventory_items.available already uses, so releasing an allocation self-heals with no arithmetic
// "give it back" step.
export async function findFifoBatchesForAllocation(inventoryItemId, tx) {
  const rows = tx
    ? (await tx.execute({
        sql: `SELECT b.id, b.qty,
                     b.qty - COALESCE((SELECT SUM(qty) FROM inventory_batch_allocations WHERE batch_id = b.id AND status = 'active'), 0) AS available_for_allocation
                FROM inventory_batches b LEFT JOIN stock_receipts sr ON sr.id = b.receipt_id
               WHERE b.inventory_item_id = ? AND b.status = 'available'
               ORDER BY sr.received_at ASC, b.id ASC`,
        args: [inventoryItemId],
      })).rows
    : await queryAll(
        `SELECT b.id, b.qty,
                b.qty - COALESCE((SELECT SUM(qty) FROM inventory_batch_allocations WHERE batch_id = b.id AND status = 'active'), 0) AS available_for_allocation
           FROM inventory_batches b LEFT JOIN stock_receipts sr ON sr.id = b.receipt_id
          WHERE b.inventory_item_id = ? AND b.status = 'available'
          ORDER BY sr.received_at ASC, b.id ASC`,
        [inventoryItemId]
      );
  return rows.filter(r => r.available_for_allocation > 0.0001);
}

// Allocate up to `qty` across FIFO batches, inside a transaction. Returns the allocation rows
// created (each { batchId, qty }) and the total actually allocated (<= requested if stock falls
// short — caller decides how to handle a shortfall, e.g. cloneBomItemForSplit for the remainder,
// same pattern reserveFromStock's scalar path already uses).
export async function allocateBatchesFifo({ inventoryItemId, qty, reservationId, status = 'active', materialIssueId = null, tx }) {
  const candidates = await findFifoBatchesForAllocation(inventoryItemId, tx);
  let remaining = round2(Number(qty));
  const created = [];
  for (const c of candidates) {
    if (remaining <= 0.0001) break;
    const take = round2(Math.min(remaining, c.available_for_allocation));
    if (take <= 0.0001) continue;
    const ins = await run(tx,
      `INSERT INTO inventory_batch_allocations (reservation_id, batch_id, qty, status, material_issue_id) VALUES (?, ?, ?, ?, ?)`,
      [reservationId || null, c.id, take, status, materialIssueId]
    );
    created.push({ id: ins.lastId, batchId: c.id, qty: take });
    remaining = round2(remaining - take);
  }
  return { allocations: created, allocatedQty: round2(Number(qty) - remaining), shortfall: remaining };
}

export async function listBatches(inventoryItemId) {
  return queryAll(
    `SELECT b.*, tc.certificate_no FROM inventory_batches b
       LEFT JOIN test_certificates tc ON tc.id = b.test_certificate_id
      WHERE b.inventory_item_id = ? ORDER BY b.id DESC`,
    [inventoryItemId]
  );
}

// Provenance lookup for a material_issues row (I8) — which batch(es)/heat(s) it actually consumed.
export async function getAllocationsForMaterialIssue(materialIssueId) {
  return queryAll(
    `SELECT a.*, b.heat_no, b.supplier_batch_no, tc.certificate_no
       FROM inventory_batch_allocations a
       JOIN inventory_batches b ON b.id = a.batch_id
       LEFT JOIN test_certificates tc ON tc.id = b.test_certificate_id
      WHERE a.material_issue_id = ?`,
    [materialIssueId]
  );
}

// The existing, already-issued allocation(s) for a bom_item's reservation (I11) — used by the
// direct-issue route to detect "this requirement was already satisfied via Reserve->Issue" before
// ever attempting a fresh allocation, and to resolve provenance for a subsequent audit-only log.
export async function getIssuedAllocationsForBomItem(bomItemId) {
  return queryAll(
    `SELECT a.*, b.heat_no, b.supplier_batch_no
       FROM inventory_batch_allocations a
       JOIN inventory_reservations r ON r.id = a.reservation_id
       JOIN inventory_batches b ON b.id = a.batch_id
      WHERE r.bom_item_id = ? AND a.status = 'issued'`,
    [bomItemId]
  );
}
