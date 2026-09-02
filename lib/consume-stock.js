// lib/consume-stock.js — Phase 3 (2026-08-26), design doc §3.6 (I8 resolution). The single owning
// consumption event for batch/serial stock, used by BOTH issueReservation() (reservation path,
// pre-existing allocations/reserved serials) and the material-issues direct-issue route (no prior
// reservation — allocates fresh FIFO). One implementation, two callers — the root cause of the
// pre-existing on_hand double-decrement risk (§0/§3.6 finding) was two paths built independently;
// this is what stops a third one from happening here.
//
// Deliberately NOT used for scalar or piece consumption (out of scope, design doc §8): scalar's
// issueReservation() keeps its exact existing on_hand decrement with no material_issues row, and
// piece consumption stays cutPiece()-only. Only batch/serial route through here.
import { withTransaction } from './db';
import { issueBatch, allocateBatchesFifo } from './inventory-batches';
import { issueSerial } from './inventory-serials';

function round2(n) { return Math.round(n * 100) / 100; }

async function pickFifoSerials(inventoryItemId, count, tx) {
  const rows = (await tx.execute({
    sql: `SELECT s.id FROM inventory_serials s LEFT JOIN stock_receipts sr ON sr.id = s.receipt_id
           WHERE s.inventory_item_id = ? AND s.status = 'available'
           ORDER BY sr.received_at ASC, s.id ASC LIMIT ?`,
    args: [inventoryItemId, count],
  })).rows;
  if (rows.length < count) throw new Error(`Only ${rows.length} available to issue`);
  return rows.map(r => r.id);
}

// existingAllocations: 'active' inventory_batch_allocations rows (from a reservation) to issue.
// existingSerialIds: 'reserved' inventory_serials ids (from a reservation) to issue.
// Omit both to allocate/pick fresh FIFO stock directly (the no-prior-reservation shortcut, A3.8) —
// qty is then required and, for serial, must be a whole-number count.
export async function consumeStock({ trackingMode, inventoryItemId, qty, bomItemId, jobCardId, username, unitCost, totalCost, existingAllocations, existingSerialIds, indentItemId }) {
  return withTransaction(async tx => {
    const ins = await tx.execute({
      sql: `INSERT INTO material_issues (bom_item_id, job_card_id, qty, issued_by, unit_cost, total_cost, indent_item_id) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [bomItemId, jobCardId || null, qty, username || null, unitCost ?? null, totalCost ?? null, indentItemId || null],
    });
    const materialIssueId = Number(ins.lastInsertRowid);

    if (trackingMode === 'batch') {
      if (existingAllocations?.length) {
        for (const a of existingAllocations) {
          const flip = await tx.execute({
            sql: `UPDATE inventory_batch_allocations SET status = 'issued', material_issue_id = ? WHERE id = ? AND status = 'active'`,
            args: [materialIssueId, a.id],
          });
          if (Number(flip.rowsAffected) !== 1) throw new Error('Allocation already issued or released — reload and retry');
          await issueBatch(a.batch_id, a.qty, tx);
        }
      } else {
        const { allocations, shortfall } = await allocateBatchesFifo({
          inventoryItemId, qty, reservationId: null, status: 'issued', materialIssueId, tx,
        });
        if (shortfall > 0.0001) throw new Error(`Only ${round2(qty - shortfall)} available to issue`);
        for (const a of allocations) await issueBatch(a.batchId, a.qty, tx);
      }
    } else if (trackingMode === 'serial') {
      const ids = existingSerialIds?.length ? existingSerialIds : await pickFifoSerials(inventoryItemId, Math.round(qty), tx);
      for (const id of ids) await issueSerial(id, materialIssueId, tx);
    }
    return { materialIssueId };
  });
}
