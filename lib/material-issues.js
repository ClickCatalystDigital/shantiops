// lib/material-issues.js — the one place a material_issues row (Stores → WIP) actually gets
// created (Feature B). Shared by Stores' own direct-issue card (app/api/material-issues/route.js)
// and the material-indent release route, so the batch/serial/scalar branching and the floor-check
// fix below live exactly once. `indentItemId` is an optional pass-through onto the created row —
// "which indent authorized this" — with zero effect on the underlying stock movement.
import { execute, queryOne } from './db';
import { getInventoryItemForBomItem } from './data';
import { consumptionCost } from './inventory-costing.mjs';
import { materialConsumptionLines } from './ledger.mjs';
import { postJournalEntry } from './ledger-post';
import { consumeStock } from './consume-stock';
import { getIssuedAllocationsForBomItem } from './inventory-batches';
import { audit } from './usb';
import { todayISO } from './date';

export async function issueMaterial({ bomItemId, qty, jobCardId = null, notes = null, username, indentItemId = null }) {
  if (!bomItemId) throw new Error('BOM item is required');
  if (!Number.isFinite(qty) || !(qty > 0)) throw new Error('Enter a quantity');

  const inventoryItem = await getInventoryItemForBomItem(bomItemId);
  const unitCost = inventoryItem ? inventoryItem.avg_cost : null;
  const totalCost = inventoryItem ? consumptionCost({ qty, avgCost: unitCost }) : null;

  // I9 (G8 fix) — a piece-tracked line's only correct consumption path is Cut; on_hand there is
  // derived from stock_pieces.status, never a number this function should touch directly.
  if (inventoryItem?.tracking_mode === 'piece') {
    throw new Error('This material is piece-tracked — use Cut, not a direct issue');
  }

  let issueId;
  if (inventoryItem && (inventoryItem.tracking_mode === 'batch' || inventoryItem.tracking_mode === 'serial')) {
    // I11 — a requirement already fully satisfied via Stores' Reserve->Issue must never be
    // double-consumed by a second, fresh allocation here.
    const [issuedBatchAllocs, issuedSerial] = await Promise.all([
      getIssuedAllocationsForBomItem(bomItemId),
      queryOne("SELECT 1 FROM inventory_serials WHERE bom_item_id = ? AND status = 'consumed'", [bomItemId]),
    ]);
    if (issuedBatchAllocs.length || issuedSerial) {
      const { lastId } = await execute(
        `INSERT INTO material_issues (bom_item_id, job_card_id, qty, issued_by, notes, unit_cost, total_cost, indent_item_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [bomItemId, jobCardId, qty, username, notes, unitCost, totalCost, indentItemId]
      );
      issueId = Number(lastId);
    } else {
      const result = await consumeStock({
        trackingMode: inventoryItem.tracking_mode, inventoryItemId: inventoryItem.id, qty,
        bomItemId, jobCardId, username, unitCost, totalCost, indentItemId,
      });
      issueId = result.materialIssueId;
      if (notes) await execute('UPDATE material_issues SET notes = ? WHERE id = ?', [notes, issueId]);
    }
  } else {
    // Scalar (or not catalog-linked at all) — same shape as before, plus a floor check that never
    // existed here: on_hand could previously go negative with no guard at all. Checked BEFORE the
    // insert (not after) so a rejected issue never leaves an orphaned material_issues row behind —
    // this path has no wrapping transaction to roll one back with.
    if (inventoryItem && totalCost > 0 && Number(inventoryItem.on_hand) < qty) {
      throw new Error(`Insufficient stock — only ${inventoryItem.on_hand} available`);
    }
    const { lastId } = await execute(
      `INSERT INTO material_issues (bom_item_id, job_card_id, qty, issued_by, notes, unit_cost, total_cost, indent_item_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [bomItemId, jobCardId, qty, username, notes, unitCost, totalCost, indentItemId]
    );
    issueId = Number(lastId);
    if (inventoryItem && totalCost > 0) {
      await execute('UPDATE inventory_items SET on_hand = on_hand - ? WHERE id = ?', [qty, inventoryItem.id]);
    }
  }

  await audit('material_issued', {
    actor: username,
    detail: `bom_item #${bomItemId} · qty ${qty}${totalCost != null ? ` · cost ${totalCost}` : ''}`,
  });

  let costed = false;
  if (inventoryItem && totalCost > 0) {
    const bomItem = await queryOne(
      `SELECT p.company FROM bom_items b JOIN projects p ON p.id = b.project_id WHERE b.id = ?`,
      [bomItemId]
    );
    if (bomItem?.company) {
      await postJournalEntry({
        company: bomItem.company,
        entryDate: todayISO(),
        sourceType: 'material_issue',
        sourceId: issueId,
        description: `Material Issue #${issueId}`,
        lines: materialConsumptionLines({ amount: totalCost }),
        createdBy: username,
      });
      costed = true;
    }
  }

  return { id: issueId, costed, unit_cost: unitCost, total_cost: totalCost };
}
