// lib/inventory-serials.js — Inventory Identity & Traceability, Phase 2. The discrete-equipment
// sibling to lib/stock-pieces.js's dimensional model: valves, pumps, motors, instruments — a valve
// is never "cut" (no geometry/lineage semantics) and is never pooled by quantity (no batch
// semantics, each row is exactly one physical unit). `code` is the ERP's own id (SR-####, same
// id-derived generation as PL-/LN-); `serial_no` is the manufacturer's own serial — a strictly
// separate, captured-never-generated column (Part 22.1's identifier categories).
import { execute, queryOne, queryAll } from './db';
import { assertTrackingMode } from './tracking-mode';

function serialCode(id) { return `SR-${String(id).padStart(4, '0')}`; }

// tx-aware run/one — same reasoning as lib/inventory-batches.js: lets issueSerial() participate in
// the larger withTransaction() Phase 3's consumeStock() needs, or run standalone unchanged.
async function run(tx, sql, args) {
  if (tx) {
    const r = await tx.execute({ sql, args });
    return { changes: Number(r.rowsAffected) };
  }
  return execute(sql, args);
}
async function one(tx, sql, args) {
  if (tx) return (await tx.execute({ sql, args })).rows[0];
  return queryOne(sql, args);
}

async function rollUpOnHand(inventoryItemId, tx) {
  const row = await one(tx, "SELECT COUNT(*) AS n FROM inventory_serials WHERE inventory_item_id = ? AND status = 'available'", [inventoryItemId]);
  await run(tx, 'UPDATE inventory_items SET on_hand = ? WHERE id = ?', [row?.n || 0, inventoryItemId]);
}

// bomItemId (optional) — same presence-only gate as receivePiece()/receiveBatch(): a non-empty
// manufacturer serial, or an existing test_certificates row for MTC.
export async function receiveSerial({ inventoryItemId, serialNo, testCertificateId, receiptId, bomItemId, username }) {
  await assertTrackingMode(inventoryItemId, 'serial');
  if (testCertificateId) {
    const cert = await queryOne('SELECT id FROM test_certificates WHERE id = ?', [testCertificateId]);
    if (!cert) throw new Error('Test certificate not found');
  }
  if (bomItemId) {
    const bomItem = await queryOne('SELECT requires_mtc, requires_serial_no FROM bom_items WHERE id = ?', [bomItemId]);
    if (bomItem?.requires_serial_no && !String(serialNo || '').trim()) {
      throw new Error('This requirement needs a serial number before it can be received');
    }
    if (bomItem?.requires_mtc && !testCertificateId) {
      throw new Error('This requirement needs an MTC/certificate before it can be received');
    }
  }

  const { lastId } = await execute(
    `INSERT INTO inventory_serials (inventory_item_id, serial_no, test_certificate_id, receipt_id, status, created_by)
     VALUES (?, ?, ?, ?, 'available', ?)`,
    [inventoryItemId, serialNo || null, testCertificateId || null, receiptId || null, username || null]
  );
  const id = Number(lastId);
  const code = serialCode(id);
  await execute('UPDATE inventory_serials SET code = ? WHERE id = ?', [code, id]);
  await rollUpOnHand(inventoryItemId);
  return { id, code };
}

export async function reserveSerial({ serialId, projectId, bomItemId }) {
  const res = await execute(
    "UPDATE inventory_serials SET status = 'reserved', project_id = ?, bom_item_id = ? WHERE id = ? AND status = 'available'",
    [projectId || null, bomItemId || null, serialId]
  );
  if (res.changes !== 1) throw new Error('Serial not available to reserve');
  return { id: serialId };
}

export async function releaseSerial(serialId) {
  const res = await execute(
    "UPDATE inventory_serials SET status = 'available', project_id = NULL, bom_item_id = NULL WHERE id = ? AND status = 'reserved'",
    [serialId]
  );
  if (res.changes !== 1) throw new Error('Serial is not reserved');
  const row = await queryOne('SELECT inventory_item_id FROM inventory_serials WHERE id = ?', [serialId]);
  await rollUpOnHand(row.inventory_item_id);
  return { id: serialId };
}

// materialIssueId (Phase 3, I8) — stamped at the moment of issue so a material_issues row can be
// resolved back to exactly this serial (and therefore its heat/MTC). tx (optional) lets this
// participate in consumeStock()'s larger transaction alongside the material_issues INSERT.
export async function issueSerial(serialId, materialIssueId = null, tx) {
  const res = await run(tx,
    "UPDATE inventory_serials SET status = 'consumed', material_issue_id = ? WHERE id = ? AND status IN ('available','reserved')",
    [materialIssueId, serialId]
  );
  if (res.changes !== 1) throw new Error("Can't issue — not available or reserved");
  const row = await one(tx, 'SELECT inventory_item_id FROM inventory_serials WHERE id = ?', [serialId]);
  await rollUpOnHand(row.inventory_item_id, tx);
  return { id: serialId };
}

export async function listSerials(inventoryItemId) {
  return queryAll(
    `SELECT s.*, tc.certificate_no FROM inventory_serials s
       LEFT JOIN test_certificates tc ON tc.id = s.test_certificate_id
      WHERE s.inventory_item_id = ? ORDER BY s.id DESC`,
    [inventoryItemId]
  );
}
