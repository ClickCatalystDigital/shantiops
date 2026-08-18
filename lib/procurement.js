// lib/procurement.js — write-side helpers shared by the Procurement redesign's API routes
// (PROCUREMENT-CHANGES.md §4.2). Split out from lib/data.js (read-only getters) since these mutate.

import { execute, queryOne, queryAll, nextCounterValue } from './db';
import { isClosedStatus, DEFAULT_PURCHASE_STATUS } from './bom-fields.mjs';
import { notifyDepartment } from './notify';
import { syncProcurementMilestones } from './milestone-auto';

// V2-CHANGES.md Phase 5.1 — purchase_status now gets written forward by the real actions that
// earn it, instead of only being inferred for display (lib/data.js's deriveActiveStage). Forward-
// only: never regresses an item that's already further along (a second quote coming in after
// selection shouldn't knock it back to Comparison), and never touches Cancelled/In-Stock (terminal,
// reached only via the cancel flow or a manual override — this helper has no business there).
const STATUS_RANK = { Enquiry: 0, Comparison: 1, Ordered: 2, Transit: 3, Received: 4 };

export async function advancePurchaseStatus(bomItemId, target) {
  const targetRank = STATUS_RANK[target];
  if (targetRank == null) return; // not a rank-tracked status (Cancelled/In-Stock) — never auto-set
  const item = await queryOne('SELECT project_id, purchase_status FROM bom_items WHERE id = ?', [bomItemId]);
  if (!item) return;
  const currentRank = STATUS_RANK[item.purchase_status];
  // A set-but-unranked status (Cancelled/In-Stock, or an unrecognized legacy token) is never
  // ours to touch — only a genuinely blank status or one already on the rank ladder is fair game.
  // (Caught live by scripts/advance-status-selfcheck.mjs: `currentRank == null` alone doesn't
  // distinguish "never set" from "set to Cancelled," so an earlier version of this guard let a
  // Comparison call silently resurrect a cancelled item.)
  if (item.purchase_status != null && currentRank == null) return;
  if (currentRank != null && currentRank >= targetRank) return; // already there or further along
  await execute('UPDATE bom_items SET purchase_status = ? WHERE id = ?', [target, bomItemId]);
  await syncProcurementMilestones(item.project_id);
}

// Point a bom_item at the winning quote — shared by POST /api/bom-items/[id]/select-supplier and
// Group 5 Bundle A's "change supplier" PO edit (app/api/purchase-orders/[id]/route.js), which needs
// the exact same re-point + tri-state + draft-PO bookkeeping, just triggered from the PO drawer
// instead of Selection. Throws a plain Error (routes translate to a 400) if the quote doesn't
// belong to this item.
export async function selectQuoteForItem(bomItemId, quoteId) {
  const item = await queryOne('SELECT * FROM bom_items WHERE id = ?', [bomItemId]);
  if (!item) throw new Error('Item not found');
  const quote = await queryOne('SELECT * FROM supplier_quotes WHERE id = ? AND bom_item_id = ?', [quoteId, bomItemId]);
  if (!quote) throw new Error('That quote is not for this item');

  await execute('UPDATE bom_items SET selected_quote_id = ? WHERE id = ?', [quote.id, bomItemId]);
  // D2 tri-state: winner=1, every other quote logged against this same item=0 (rejected, not
  // deleted — the append-only log stays intact).
  await execute('UPDATE supplier_quotes SET is_selected = 1 WHERE id = ?', [quote.id]);
  await execute('UPDATE supplier_quotes SET is_selected = 0 WHERE bom_item_id = ? AND id != ?', [bomItemId, quote.id]);
  const poId = await addItemToDraftPO(item, quote);
  return { poId, quote };
}

// Auto-drafts (or appends to) one `draft` PO per supplier as items get a winning quote selected —
// the mechanism behind "as selection is done, the Purchase Orders tab starts getting populated"
// (§4.2). Idempotent per item: pulls any existing draft po_items row for this item first, so
// re-selecting a different supplier moves it rather than leaving a stale duplicate behind. Never
// touches an already-issued PO — this only ever creates/grows drafts.
export async function addItemToDraftPO(bomItem, quote) {
  await removeItemFromDraftPO(bomItem.id);

  let po = await queryOne(
    "SELECT id, po_no FROM purchase_orders WHERE supplier_id = ? AND status = 'draft' ORDER BY id DESC LIMIT 1",
    [quote.supplier_id]
  );
  if (!po) {
    // Same po_no format as the manual PO route (NNN/SB/YYYY-YY, Indian FY) — this auto-draft
    // replaces that route's UI trigger, not its numbering scheme.
    const now = new Date();
    const fyStart = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
    const seq = await nextCounterValue('po_no', 578);
    const poNo = `${seq}/SB/${fyStart}-${String((fyStart + 1) % 100).padStart(2, '0')}`;
    const { lastId } = await execute(
      'INSERT INTO purchase_orders (po_no, supplier_id, payment_terms) VALUES (?, ?, ?)',
      [poNo, quote.supplier_id, quote.payment_terms || null]
    );
    po = { id: Number(lastId), po_no: poNo };
  }

  const qty = parseFloat(bomItem.qty_text) || 1;
  const amount = Math.round(qty * quote.unit_price * 100) / 100;
  const countRow = await queryOne('SELECT COUNT(*) AS c FROM po_items WHERE po_id = ?', [po.id]);
  const sortOrder = countRow?.c ?? 0;
  await execute(
    `INSERT INTO po_items (po_id, bom_item_id, project_id, description, qty, uom, rate, amount, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [po.id, bomItem.id, bomItem.project_id, bomItem.material_description, qty, quote.uom || null, quote.unit_price, amount, sortOrder]
  );
  return po.id;
}

// Undo half of the above — pulls one item out of whichever draft PO it's currently on, deleting
// the PO too if that was its last line. Never touches an issued PO (nothing to undo there once
// issued — that's Cancel Issue, §4.3, a different action on a different button).
export async function removeItemFromDraftPO(bomItemId) {
  const lines = await queryAll(
    `SELECT pi.id AS po_item_id, pi.po_id FROM po_items pi
       JOIN purchase_orders po ON po.id = pi.po_id
      WHERE pi.bom_item_id = ? AND po.status = 'draft'`,
    [bomItemId]
  );
  for (const line of lines) {
    await execute('DELETE FROM po_items WHERE id = ?', [line.po_item_id]);
    const remaining = await queryOne('SELECT COUNT(*) AS c FROM po_items WHERE po_id = ?', [line.po_id]);
    if (remaining.c === 0) await execute('DELETE FROM purchase_orders WHERE id = ?', [line.po_id]);
  }
}

// V2-CHANGES.md Group 6 Phase 6.3 (D6/D9) — reserved/available inventory. qty_text is free text
// ("4 Nos") and never parsed for arithmetic elsewhere in this codebase either (addItemToDraftPO's
// own `parseFloat(bomItem.qty_text) || 1` above is the closest precedent — a leading-number read,
// same idiom this reuses); this only splits the text label to keep the two rows' displays sane.
// Falls back to the raw numbers with no unit if the leading-number pattern doesn't match.
// ponytail: regex qty-text split, good enough for "N Unit" labels; revisit if a real qty_text shape
// breaks it (e.g. multi-part composite quantities).
function splitQtyText(qtyText, qtyA, qtyB) {
  const m = String(qtyText || '').match(/^\s*(\d+(?:\.\d+)?)\s*(.*)$/);
  const suffix = m ? m[2].trim() : '';
  return [suffix ? `${qtyA} ${suffix}` : `${qtyA}`, suffix ? `${qtyB} ${suffix}` : `${qtyB}`];
}

// The Reserve action (D9's "Stores confirm step" is really reserve -> issue, not a single
// decrement — see V2-CHANGES.md Phase 6.3). `available` (on_hand minus every active reservation)
// is the pool this draws from, so a bom item can never be double-promised the same physical units
// whether the competing request is source='bom', 'stock', or 'sas' (they all read the same pool).
// Reserving less than requested reserves what's available and splits the bom_items row: the
// original keeps running normal procurement for the shortfall, a new cloned row (same project/
// source/sale_order_no) carries the reserved qty and is what the reservation actually points at.
export async function reserveFromStock({ inventoryItemId, bomItemId, qty, username }) {
  const invItem = await queryOne('SELECT * FROM inventory_items WHERE id = ?', [inventoryItemId]);
  if (!invItem) throw new Error('Inventory item not found');
  const bomItem = await queryOne('SELECT * FROM bom_items WHERE id = ?', [bomItemId]);
  if (!bomItem) throw new Error('Request not found');
  // Found live, post-ship: issueReservation() unconditionally sets purchase_status='In-Stock' —
  // reserving against an already-terminal item (Received/Cancelled/In-Stock) and then Issuing it
  // would silently resurrect/overwrite a resolved item's status. getOpenBomItems() already keeps
  // this out of the UI's Open Requests list, but the route itself had no server-side guard — same
  // "never touch a terminal status" lesson Phase 5.1's advancePurchaseStatus already learned once.
  if (isClosedStatus(bomItem.purchase_status || DEFAULT_PURCHASE_STATUS)) {
    throw new Error(`Can't reserve — already ${bomItem.purchase_status}`);
  }

  const reservedRow = await queryOne(
    `SELECT COALESCE(SUM(qty), 0) AS reserved FROM inventory_reservations
      WHERE inventory_item_id = ? AND status = 'active'`,
    [inventoryItemId]
  );
  const available = invItem.on_hand - (reservedRow?.reserved || 0);
  const requested = Number(qty);
  if (!(requested > 0)) throw new Error('Quantity must be greater than zero');
  const reserveQty = Math.min(requested, available);
  if (reserveQty <= 0) throw new Error('Nothing available to reserve');
  const shortfall = requested - reserveQty;

  let targetBomItemId = bomItemId;
  if (shortfall > 0) {
    const [remainingQtyText, reservedQtyText] = splitQtyText(bomItem.qty_text, shortfall, reserveQty);
    await execute('UPDATE bom_items SET qty_text = ? WHERE id = ?', [remainingQtyText, bomItemId]);
    const { lastId } = await execute(
      `INSERT INTO bom_items (project_id, material_description, moc, size_spec, section, qty_text,
                               purchase_status, source, sale_order_no, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [bomItem.project_id, bomItem.material_description, bomItem.moc, bomItem.size_spec, bomItem.section,
        reservedQtyText, bomItem.purchase_status, bomItem.source, bomItem.sale_order_no, bomItem.sort_order]
    );
    targetBomItemId = Number(lastId);
  }

  const { lastId: reservationId } = await execute(
    `INSERT INTO inventory_reservations (inventory_item_id, bom_item_id, qty, status, created_by)
     VALUES (?, ?, ?, 'active', ?)`,
    [inventoryItemId, targetBomItemId, reserveQty, username]
  );
  return { reservationId: Number(reservationId), reservedQty: reserveQty, shortfall, bomItemId: targetBomItemId };
}

// The Issue action — the actual D9 "confirm" moment: Stores physically hands the material out.
// Only now does on_hand actually move and the item become terminal In-Stock (D6); Reserve alone
// never touches on_hand.
export async function issueReservation(reservationId) {
  const res = await queryOne('SELECT * FROM inventory_reservations WHERE id = ?', [reservationId]);
  if (!res) throw new Error('Reservation not found');
  if (res.status !== 'active') throw new Error(`Reservation already ${res.status}`);

  await execute("UPDATE inventory_reservations SET status = 'issued', issued_at = CURRENT_TIMESTAMP WHERE id = ?", [reservationId]);
  await execute('UPDATE inventory_items SET on_hand = on_hand - ? WHERE id = ?', [res.qty, res.inventory_item_id]);
  await execute(
    "UPDATE bom_items SET purchase_status = 'In-Stock', inventory_item_id = ?, inventory_qty = ? WHERE id = ?",
    [res.inventory_item_id, res.qty, res.bom_item_id]
  );
  const bomItem = await queryOne('SELECT project_id FROM bom_items WHERE id = ?', [res.bom_item_id]);
  if (bomItem) await syncProcurementMilestones(bomItem.project_id);
  // Defensive no-op in the normal path (a reserved item shouldn't have a draft-PO line), but a
  // manual override elsewhere could have created one — cheap to guard against.
  await removeItemFromDraftPO(res.bom_item_id);
  return res;
}

// The Release action — frees a reservation's qty back into `available` without touching on_hand
// (nothing was ever decremented). No-op on an already-released/issued reservation, so callers
// (including the auto-release below) don't need to check status first.
export async function releaseReservation(reservationId) {
  const res = await queryOne('SELECT * FROM inventory_reservations WHERE id = ?', [reservationId]);
  if (!res) throw new Error('Reservation not found');
  if (res.status !== 'active') return res;
  await execute("UPDATE inventory_reservations SET status = 'released', released_at = CURRENT_TIMESTAMP WHERE id = ?", [reservationId]);

  // STORES-SALES-CHANGES.md — a released reservation against a still-gated (pending_review) line
  // needs a fresh Reserve/Procure decision; nothing else re-flags that. Skipped when this release
  // is really cancel-cleanup (releaseReservationsForItem, called from the cancel route right after
  // purchase_status is already set to 'Cancelled') — that item is terminal, not awaiting anything.
  const item = await queryOne(
    'SELECT id, material_description, pending_review, purchase_status FROM bom_items WHERE id = ?', [res.bom_item_id]);
  if (item?.pending_review && !isClosedStatus(item.purchase_status || DEFAULT_PURCHASE_STATUS)) {
    try {
      await notifyDepartment('Stores', {
        kind: 'bom_released', title: 'Reservation released — needs a decision',
        body: item.material_description, dedupe_key: `reservation_released:${reservationId}`,
      });
    } catch (err) { /* notification is best-effort */ }
  }
  return res;
}

// Cancelling a bom_item (POST /api/bom-items/[id]/cancel, Bundle B) must release any reservation
// still sitting active against it — otherwise that stock stays phantom-committed forever, invisible
// to `available` with no request left to issue it against.
export async function releaseReservationsForItem(bomItemId) {
  const active = await queryAll("SELECT id FROM inventory_reservations WHERE bom_item_id = ? AND status = 'active'", [bomItemId]);
  for (const r of active) await releaseReservation(r.id);
}
