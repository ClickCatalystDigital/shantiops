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
import { consumeReservedStock } from './procurement';
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
    // Stores/Inventory hardening Phase 3 — the floor check previously compared against raw on_hand
    // only, never subtracting active inventory_reservations, so a direct issue could silently
    // consume stock another bom_item had already reserved. Now checks true available (on_hand minus
    // active reservations), the same figure reserveFromStock's own available computation uses.
    // STORES_DEPARTMENT.md Gap #3 fix — gated on `inventoryItem` alone, not `totalCost > 0`.
    // avg_cost is NOT NULL DEFAULT 0, so any never-costed line (real stock received but no Vendor
    // Bill approved against it yet — e.g. via the Inward-approval scalar release path, which
    // credits on_hand unconditionally, independent of costing) silently skipped BOTH the floor
    // check and the decrement below: on_hand could go arbitrarily over-issued, and never actually
    // moved for a real, physical issue. Costing (the journal-entry block further down) is a
    // genuinely separate concern from quantity tracking and keeps its own, correct totalCost > 0
    // gate — only the physical stock-movement guards move here.
    //
    // Reservation/Issue reconciliation fix — that Round-1 floor check counted EVERY active
    // reservation against this inventory_item, including this exact bom_item's own (auto-reserved
    // at receipt, or manually reserved earlier) — so any bom_item whose own demand was already
    // reserved self-blocked the instant it tried to Issue that same stock via a Material Indent. An
    // Issue must draw down its own bom_item's reservation first (consumeReservedStock, the actual
    // commitment the business made to this line) and only floor-check the general pool for whatever
    // wasn't already reserved for it — never a separate, independent stock consumption.
    if (inventoryItem) {
      const { shortfall } = await consumeReservedStock({ bomItemId, qty });
      if (shortfall > 0) {
        // Own reservation didn't cover the whole request (a non-catalog-linked line that was never
        // auto-reserved, or Production indenting more than was ever reserved) — the unreserved
        // remainder still has to clear the general pool, the exact same guard as before, now
        // correctly reading `qty - qty_issued` per row rather than the row's original qty, so a
        // reservation this same call just partially/fully claimed above doesn't get double-counted
        // against itself.
        const reservedRow = await queryOne(
          `SELECT COALESCE(SUM(qty - qty_issued), 0) AS reserved FROM inventory_reservations WHERE inventory_item_id = ? AND status = 'active'`,
          [inventoryItem.id]
        );
        const available = Number(inventoryItem.on_hand) - (Number(reservedRow?.reserved) || 0);
        if (available < shortfall) {
          throw new Error(`Insufficient stock — only ${available} available (${inventoryItem.on_hand} on hand, some already reserved)`);
        }
      }
    }
    const { lastId } = await execute(
      `INSERT INTO material_issues (bom_item_id, job_card_id, qty, issued_by, notes, unit_cost, total_cost, indent_item_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [bomItemId, jobCardId, qty, username, notes, unitCost, totalCost, indentItemId]
    );
    issueId = Number(lastId);
    if (inventoryItem) {
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
