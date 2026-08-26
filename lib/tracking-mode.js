// lib/tracking-mode.js — the single source of truth for which physical-stock model (if any) an
// inventory_items row uses: scalar | piece | batch | serial. Design doc Part 18.1 / Part 19 I1-I3.
// Three write-path guards, not a DB CHECK constraint: SQLite/libSQL can't express "exactly one of
// three sibling tables is populated" as a table constraint, and this also covers the 'scalar'
// (no child table at all) case a cross-table CHECK couldn't.
import { execute, queryOne } from './db';

// A line's first-ever receipt auto-adopts that mode (same "opt-in on first piece" precedent
// inventory_items.track_pieces already had) — but once adopted, every subsequent receive of a
// DIFFERENT kind is rejected (I2). Called by receivePiece()/receiveBatch()/receiveSerial() before
// any row is written.
export async function assertTrackingMode(inventoryItemId, mode) {
  const invItem = await queryOne('SELECT tracking_mode FROM inventory_items WHERE id = ?', [inventoryItemId]);
  if (!invItem) throw new Error('Inventory item not found');
  if (invItem.tracking_mode === 'scalar') {
    await execute('UPDATE inventory_items SET tracking_mode = ? WHERE id = ?', [mode, inventoryItemId]);
    return;
  }
  if (invItem.tracking_mode !== mode) {
    throw new Error(`This inventory line is tracked as '${invItem.tracking_mode}', not '${mode}'`);
  }
}

export async function countTrackedChildren(inventoryItemId) {
  const [pieces, batches, serials] = await Promise.all([
    queryOne('SELECT COUNT(*) AS n FROM stock_pieces WHERE inventory_item_id = ?', [inventoryItemId]),
    queryOne('SELECT COUNT(*) AS n FROM inventory_batches WHERE inventory_item_id = ?', [inventoryItemId]),
    queryOne('SELECT COUNT(*) AS n FROM inventory_serials WHERE inventory_item_id = ?', [inventoryItemId]),
  ]);
  return (pieces?.n || 0) + (batches?.n || 0) + (serials?.n || 0);
}

// Explicit mode change (I3) — only ever safe while the line has zero tracked child rows anywhere;
// switching after real physical stock exists would orphan it under the wrong model.
export async function setTrackingMode(inventoryItemId, mode) {
  const existing = await countTrackedChildren(inventoryItemId);
  if (existing > 0) throw new Error("Can't change tracking mode — this line already has tracked stock");
  await execute('UPDATE inventory_items SET tracking_mode = ? WHERE id = ?', [mode, inventoryItemId]);
}
