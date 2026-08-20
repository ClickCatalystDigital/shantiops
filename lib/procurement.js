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
// Exported — lib/remnant-match.js's matchAndReserve reuses the exact same split for its own
// partial-fulfillment case (a dimensional BOM line, matched by pieces instead of plain quantity).
export function splitQtyText(qtyText, qtyA, qtyB) {
  const m = String(qtyText || '').match(/^\s*(\d+(?:\.\d+)?)\s*(.*)$/);
  const suffix = m ? m[2].trim() : '';
  return [suffix ? `${qtyA} ${suffix}` : `${qtyA}`, suffix ? `${qtyB} ${suffix}` : `${qtyB}`];
}

// Clone a bom_item row for a partial-fulfillment split — shared by reserveFromStock below (plain-
// qty stock reservation) and lib/remnant-match.js's matchAndReserve (dimensional remnant matching).
// Carries the catalog/category link forward (the original split INSERT dropped item_id/category/
// category_fields_json, silently losing a picked-from-catalog line's link on the fulfilled clone —
// fixed here for both callers) and lets the caller decide pending_review: reserveFromStock leaves
// it at the column default (0, unchanged behavior — a stock-reserved line still becomes visible to
// Procurement once release_bom is done, same as before; Procurement's UI already shows its
// reserved_qty so nothing there gets double-sourced), while a remnant match forces it to 1 so the
// fulfilled clone never reaches Procurement's queue at all.
export async function cloneBomItemForSplit(bomItem, { qtyText, pendingReview = false }) {
  const { lastId } = await execute(
    `INSERT INTO bom_items (project_id, material_description, moc, size_spec, section, qty_text,
                             purchase_status, source, sale_order_no, sort_order, item_id, category,
                             category_fields_json, pending_review)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [bomItem.project_id, bomItem.material_description, bomItem.moc, bomItem.size_spec, bomItem.section,
      qtyText, bomItem.purchase_status, bomItem.source, bomItem.sale_order_no, bomItem.sort_order,
      bomItem.item_id, bomItem.category, bomItem.category_fields_json, pendingReview ? 1 : 0]
  );
  return Number(lastId);
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
    targetBomItemId = await cloneBomItemForSplit(bomItem, { qtyText: reservedQtyText });
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

// Stores Allocation Mode — global, persisted in app_settings (lib/db.js). 'auto' is the default:
// undo the old always-manual behavior only by choosing it here, not by special-casing every caller.
export async function getAllocationMode() {
  const row = await queryOne("SELECT value FROM app_settings WHERE key = 'stores_allocation_mode'", []);
  return row?.value === 'manual' ? 'manual' : 'auto';
}
export async function setAllocationMode(mode) {
  const value = mode === 'manual' ? 'manual' : 'auto';
  await execute(
    `INSERT INTO app_settings (key, value) VALUES ('stores_allocation_mode', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [value]
  );
  return value;
}

// Auto mode's plain-quantity counterpart to lib/remnant-match.js's matchAndReserve — same shape,
// same shared split/clone helpers, just for ordinary on_hand/available stock instead of tracked
// stock_pieces. Only ever matches on an exact catalog identity (bom_item.item_id ===
// inventory_items.item_id), the same real signal possibleMatches() already trusts client-side for
// its green "✓" badge — never the fuzzy keyword-overlap fallback, which was already rejected once
// (STORES-SALES-CHANGES.md §3.1) as not safe to auto-commit physical stock against.
//
// Full match: no clone (reserveFromStock's own default), so the original row itself is force-gated
// pending_review=1 here — mirrors matchAndReserve's full-match branch exactly, so it stops
// satisfying getSourcingItems() and needs no further Stores action. Partial match: reserveFromStock
// already split the row — the clone (the reserved portion) gets the same pending_review=1 gate; the
// original row keeps the unmet remainder at whatever pending_review it was inserted with (0 in auto
// mode — see the call sites), so it's immediately visible to Procurement, no Stores click needed.
export async function autoReserveFromStock(bomItem, username = 'system') {
  if (!bomItem?.item_id) return { matched: 0 };
  if (['plate', 'ms_section', 'angle'].includes(bomItem.category)) return { matched: 0 }; // remnant-match's territory

  const qtyMatch = String(bomItem.qty_text || '').match(/^\s*(\d+(?:\.\d+)?)/);
  const requested = qtyMatch ? Number(qtyMatch[1]) : 0;
  if (!(requested > 0)) return { matched: 0 };

  const invItem = await queryOne(
    `SELECT i.id, i.on_hand - COALESCE((SELECT SUM(r.qty) FROM inventory_reservations r
                                          WHERE r.inventory_item_id = i.id AND r.status = 'active'), 0) AS available
       FROM inventory_items i WHERE i.item_id = ? AND i.track_pieces = 0`,
    [bomItem.item_id]
  );
  if (!invItem || !(invItem.available > 0)) return { matched: 0 };

  let result;
  try {
    result = await reserveFromStock({ inventoryItemId: invItem.id, bomItemId: bomItem.id, qty: requested, username });
  } catch (err) {
    return { matched: 0 }; // lost a race for the same stock, or already terminal — leave it for Procurement
  }
  await execute('UPDATE bom_items SET pending_review = 1 WHERE id = ?', [result.bomItemId]);
  return { matched: result.reservedQty, shortfall: result.shortfall, targetBomItemId: result.bomItemId };
}

// Auto mode's one meaningful Procurement-facing notification (task §17: "Procurement receives a
// new shortage"). Manual mode never calls this — Procurement already gets notified there via the
// explicit Procure click (app/api/bom-items/[id]/procure/route.js). Best-effort, one per bom_item,
// so re-checking a line that never changes state never re-notifies.
export async function notifyProcurementIfShortfall(bomItemId) {
  const item = await queryOne('SELECT id, material_description, pending_review, purchase_status FROM bom_items WHERE id = ?', [bomItemId]);
  if (!item || item.pending_review || isClosedStatus(item.purchase_status || DEFAULT_PURCHASE_STATUS)) return;
  try {
    await notifyDepartment('Procurement', {
      kind: 'request', title: 'New Enquiry item (auto-allocated shortfall)', body: item.material_description,
      dedupe_key: `auto_shortage:${item.id}`,
    });
  } catch (err) { /* notification is best-effort */ }
}

// Every non-dimensional, catalog-linked line on a project — the release-bom hook's plain-stock
// sibling to matchProjectBom. Only rows still open for review (pending_review=0, meaning auto mode
// already decided not to gate them) are candidates; dimensional categories are matchProjectBom's.
export async function matchProjectPlainStock(projectId, username = 'system') {
  const items = await queryAll(
    `SELECT * FROM bom_items WHERE project_id = ? AND pending_review = 0 AND item_id IS NOT NULL
       AND (category IS NULL OR category NOT IN ('plate','ms_section','angle'))`,
    [projectId]
  );
  const results = [];
  for (const item of items) {
    const r = await autoReserveFromStock(item, username);
    if (r.matched > 0) results.push({ bomItemId: item.id, ...r });
  }
  return results;
}
