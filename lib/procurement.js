// lib/procurement.js — write-side helpers shared by the Procurement redesign's API routes
// (PROCUREMENT-CHANGES.md §4.2). Split out from lib/data.js (read-only getters) since these mutate.

import { execute, queryOne, queryAll, nextCounterValue, withTransaction } from './db';
import { isClosedStatus, DEFAULT_PURCHASE_STATUS, DIMENSIONAL_CATEGORIES } from './bom-fields.mjs';
import { itemRollupQty, isFullyReservedFromStock } from './bom-structure.mjs';
import { notifyDepartment } from './notify';
import { syncProcurementMilestones } from './milestone-auto';
import { allocateBatchesFifo } from './inventory-batches';
import { releaseSerial } from './inventory-serials';
import { consumeStock } from './consume-stock';
import { getAssemblyRollupMap, getProjectUnitCounts } from './data';

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
  await maybeCloseRfqsForItem(bomItemId);
  // PR-group award rollup (root cause, not a per-caller patch) — this function has three real
  // callers (the single-item Selection route, the PO drawer's "change supplier" edit, and the new
  // PR-group batch award route's own loop), and the header-level state depends on every
  // constituent regardless of which one moved it. No-op for the vast majority of items, which have
  // no pr_item_id at all.
  if (item.pr_item_id) await refreshPrAwardState(item.pr_item_id);
  return { poId, quote };
}

// Undo half of selectQuoteForItem — shared by DELETE /api/bom-items/[id]/select-supplier and the
// PR-group batch route's own undo loop, same root-cause reasoning as the select side above.
export async function deselectQuoteForItem(bomItemId) {
  const item = await queryOne('SELECT id, pr_item_id FROM bom_items WHERE id = ?', [bomItemId]);
  if (!item) throw new Error('Item not found');
  await execute('UPDATE bom_items SET selected_quote_id = NULL WHERE id = ?', [bomItemId]);
  // D2: undo means undecided again — reset every quote on this item, not just the former winner.
  await execute('UPDATE supplier_quotes SET is_selected = NULL WHERE bom_item_id = ?', [bomItemId]);
  await removeItemFromDraftPO(bomItemId);
  if (item.pr_item_id) await refreshPrAwardState(item.pr_item_id);
}

// Recomputes purchase_requisitions.status/awarded_supplier_id for the whole PR header that owns
// prItemId. purchase_requisitions.status/awarded_supplier_id are declared in schema but were never
// written or read anywhere before this — a header can have several pr_items lines, so it only
// honestly reads 'awarded' once EVERY line under it that still has something to source (excluding
// stock-reserved clones, same predicate the PR-group aggregate view uses — a line with nothing left
// to source casts no opinion, it can't block the header) is ALSO uniformly awarded to the exact
// same supplier. Guarded `AND status != 'closed'` in both directions (defensive — nothing writes
// 'closed' today either, but matches this app's own "never touch a terminal status" convention).
export async function refreshPrAwardState(prItemId) {
  const prItem = await queryOne('SELECT pr_id FROM pr_items WHERE id = ?', [prItemId]);
  if (!prItem) return;
  const lines = await queryAll('SELECT id FROM pr_items WHERE pr_id = ?', [prItem.pr_id]);
  const [rollupById, unitCounts] = await Promise.all([getAssemblyRollupMap(), getProjectUnitCounts()]);

  let commonSupplierId = null, anyOpinion = false, uniform = true;
  for (const line of lines) {
    const rows = await queryAll(
      `SELECT b.qty_text, b.assembly_id, b.project_id, b.qty_resolved, sq.supplier_id,
              (SELECT COALESCE(SUM(ir.qty), 0) FROM inventory_reservations ir
                WHERE ir.bom_item_id = b.id AND ir.status = 'active') AS reserved_qty
         FROM bom_items b LEFT JOIN supplier_quotes sq ON sq.id = b.selected_quote_id
        WHERE b.pr_item_id = ?`,
      [line.id]
    );
    for (const r of rows) {
      const resolvedQty = itemRollupQty(r.qty_text, r.assembly_id, rollupById, unitCounts.get(r.project_id) ?? 1, !!r.qty_resolved) ?? 0;
      if (isFullyReservedFromStock(resolvedQty, r.reserved_qty)) continue; // already covered — no opinion, doesn't block
      anyOpinion = true;
      if (!r.supplier_id) { uniform = false; break; }
      if (commonSupplierId == null) commonSupplierId = r.supplier_id;
      else if (r.supplier_id !== commonSupplierId) { uniform = false; break; }
    }
    if (!uniform) break;
  }

  if (anyOpinion && uniform && commonSupplierId != null) {
    await execute(
      "UPDATE purchase_requisitions SET status = 'awarded', awarded_supplier_id = ? WHERE id = ? AND status != 'closed'",
      [commonSupplierId, prItem.pr_id]
    );
  } else {
    await execute(
      "UPDATE purchase_requisitions SET status = 'open', awarded_supplier_id = NULL WHERE id = ? AND status != 'closed'",
      [prItem.pr_id]
    );
  }
}

// An awarded/cancelled line's own outstanding RFQ invitations are moot — a supplier who already lost
// (or an item that's dead) shouldn't still be able to submit a fresh quote through a live link. But
// one RFQ can cover several BOM items at once (one supplier's portal link lists everything they were
// invited on), so closing the whole RFQ the moment a SINGLE item is decided would wrongly cut off
// quote collection for that RFQ's other, still-undecided items. Only close once every item the RFQ
// contains has reached a terminal state (Cancelled, or awarded via selected_quote_id). Never deletes
// anything and never touches an already-responded invite — same append-only-history precedent as
// everything else here.
export async function maybeCloseRfqsForItem(bomItemId) {
  const rfqIds = await queryAll('SELECT DISTINCT rfq_id FROM rfq_items WHERE bom_item_id = ?', [bomItemId]);
  for (const { rfq_id } of rfqIds) {
    const siblings = await queryAll(
      `SELECT b.purchase_status, b.selected_quote_id FROM rfq_items ri
        JOIN bom_items b ON b.id = ri.bom_item_id WHERE ri.rfq_id = ?`,
      [rfq_id]
    );
    const allDecided = siblings.every(b => b.purchase_status === 'Cancelled' || b.selected_quote_id != null);
    if (!allDecided) continue;
    await execute("UPDATE rfqs SET status = 'closed' WHERE id = ? AND status != 'closed'", [rfq_id]);
    // A genuine past epoch-ms, not 0 — the public route's guard is `token_expires &&
    // token_expires < Date.now()`, and 0 is falsy, so it would silently skip the expiry check
    // entirely instead of rejecting.
    await execute(
      "UPDATE rfq_suppliers SET token_expires = 1 WHERE rfq_id = ? AND responded_at IS NULL",
      [rfq_id]
    );
  }
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

  const [rollupById, unitCounts] = await Promise.all([
    getAssemblyRollupMap(bomItem.project_id), getProjectUnitCounts(bomItem.project_id),
  ]);
  const qty = itemRollupQty(bomItem.qty_text, bomItem.assembly_id, rollupById, unitCounts.get(bomItem.project_id) ?? 1, !!bomItem.qty_resolved) ?? 1;
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
    // A po_item's delivery-lot allocations don't carry over once it leaves this draft PO (a new
    // supplier/removal means the old delivery commitment no longer applies) — clear them, and drop
    // any lot left with zero items as a result, before the po_items row itself disappears.
    const affectedLots = await queryAll('SELECT DISTINCT lot_id FROM po_delivery_lot_items WHERE po_item_id = ?', [line.po_item_id]);
    await execute('DELETE FROM po_delivery_lot_items WHERE po_item_id = ?', [line.po_item_id]);
    // Same reasoning, and a real pre-existing gap this line's own FK caught live (Turso enforces
    // FKs on this connection) — bom_item_expected_children (Stores' unit-routing reference, no
    // qty/date of its own, §edit_lots) wasn't cleaned up here before, so a po_item still carrying
    // one could never actually be deleted at all: the po_items DELETE below would throw a raw
    // FOREIGN KEY error and silently block Change Supplier / Undo Selection / Cancel entirely. Same
    // discard-it-not-worth-carrying-forward logic as the delivery-lot rows just above.
    await execute('DELETE FROM bom_item_expected_children WHERE po_item_id = ?', [line.po_item_id]);
    for (const { lot_id } of affectedLots) {
      const remainingItems = await queryOne('SELECT COUNT(*) AS c FROM po_delivery_lot_items WHERE lot_id = ?', [lot_id]);
      if (remainingItems.c === 0) await execute('DELETE FROM po_delivery_lots WHERE id = ?', [lot_id]);
    }
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
// fulfilled clone never reaches Procurement's queue at all. qty_resolved is always 1, unconditional
// — this row's qty_text is by construction the already-total-space "reserved/matched" portion of a
// split, never a per-instance base figure, so no future read may apply any rollup multiplier to it.
export async function cloneBomItemForSplit(bomItem, { qtyText, pendingReview = false }) {
  const { lastId } = await execute(
    `INSERT INTO bom_items (project_id, material_description, moc, size_spec, section, qty_text,
                             purchase_status, source, sale_order_no, sort_order, item_id, category,
                             category_fields_json, requires_heat_no, requires_mtc,
                             requires_supplier_batch, requires_serial_no, requires_manufacturing,
                             pending_review, qty_resolved, pr_item_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
    [bomItem.project_id, bomItem.material_description, bomItem.moc, bomItem.size_spec, bomItem.section,
      qtyText, bomItem.purchase_status, bomItem.source, bomItem.sale_order_no, bomItem.sort_order,
      bomItem.item_id, bomItem.category, bomItem.category_fields_json,
      // Previously dropped entirely on a partial-fulfillment split — a line requiring a heat
      // number/MTC/batch/serial number lost that requirement on the split-off clone, silently
      // (found auditing this round). Copied verbatim from the source row, same as `duplicate`
      // (the assembly-node duplicate route) already does correctly.
      bomItem.requires_heat_no ? 1 : 0, bomItem.requires_mtc ? 1 : 0,
      bomItem.requires_supplier_batch ? 1 : 0, bomItem.requires_serial_no ? 1 : 0,
      bomItem.requires_manufacturing === 0 || bomItem.requires_manufacturing === false ? 0 : 1,
      pendingReview ? 1 : 0,
      // Previously dropped too — the split-off clone (the actually-reserved/matched portion) lost
      // its trace back to the PR line it came from, breaking the stock-piece -> PR traceability
      // chain exactly in the partial-fulfillment case. bomItem.pr_item_id is null for anything not
      // raised through the unified PR flow, so this is a no-op for those rows.
      bomItem.pr_item_id ?? null]
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
  // Phase 3 (G3) — piece/serial-tracked lines are never reserved through this generic, qty-blind
  // path. Pieces already have their own Reserve action (Pieces dialog -> reservePiece()); serial
  // gains the equivalent (Serials dialog -> reserveSerial()) in this same round. Rejecting here,
  // not just hiding it in the UI, closes the gap for real rather than by convention only.
  if (invItem.tracking_mode === 'piece' || invItem.tracking_mode === 'serial') {
    throw new Error(`This line is ${invItem.tracking_mode}-tracked — reserve a specific ${invItem.tracking_mode} instead`);
  }
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
    // qty_resolved=1 — shortfall is already a total-space "still needed" figure (requested minus
    // what was just reserved), not a per-instance base one; a future re-read must never re-apply the
    // rollup multiplier on top of it (that's the split-qty double-counting bug this column fixes).
    await execute('UPDATE bom_items SET qty_text = ?, qty_resolved = 1 WHERE id = ?', [remainingQtyText, bomItemId]);
    targetBomItemId = await cloneBomItemForSplit(bomItem, { qtyText: reservedQtyText });
  }

  // Batch-tracked (Phase 3, §3.2): the reservation header is unchanged, but a batch is a pool that
  // may need splitting across several physical batches/heats — allocate inside one transaction so
  // the per-batch CAS guard (issueBatch's fix applies at issue time; allocation itself just needs
  // the read-then-insert to be atomic here, same lesson as Phase 0's cutPiece).
  if (invItem.tracking_mode === 'batch') {
    return withTransaction(async tx => {
      const ins = await tx.execute({
        sql: `INSERT INTO inventory_reservations (inventory_item_id, bom_item_id, qty, status, created_by) VALUES (?, ?, ?, 'active', ?)`,
        args: [inventoryItemId, targetBomItemId, reserveQty, username],
      });
      const reservationId = Number(ins.lastInsertRowid);
      const { shortfall: allocShortfall } = await allocateBatchesFifo({ inventoryItemId, qty: reserveQty, reservationId, status: 'active', tx });
      if (allocShortfall > 0.0001) throw new Error('Stock changed concurrently — reload and try again');
      return { reservationId, reservedQty: reserveQty, shortfall, bomItemId: targetBomItemId };
    });
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
export async function issueReservation(reservationId, { username, jobCardId } = {}) {
  const res = await queryOne('SELECT * FROM inventory_reservations WHERE id = ?', [reservationId]);
  if (!res) throw new Error('Reservation not found');
  if (res.status !== 'active') throw new Error(`Reservation already ${res.status}`);
  const invItem = await queryOne('SELECT tracking_mode FROM inventory_items WHERE id = ?', [res.inventory_item_id]);

  await execute("UPDATE inventory_reservations SET status = 'issued', issued_at = CURRENT_TIMESTAMP WHERE id = ?", [reservationId]);
  // Phase 3 (§3.6, I8) — batch-tracked reservations become the reservation path's canonical
  // consumption event: consumeStock() creates the material_issues row itself and stamps
  // material_issue_id onto every allocation it issues, so "which heat did this consume" is always
  // answerable from material_issues, not just from the BOM line. Scalar keeps its exact pre-existing
  // behavior (a raw on_hand decrement, no material_issues row) — out of scope, already correct for
  // what it is (design doc §8).
  if (invItem?.tracking_mode === 'batch') {
    const activeAllocations = await queryAll(
      "SELECT * FROM inventory_batch_allocations WHERE reservation_id = ? AND status = 'active'", [reservationId]);
    await consumeStock({
      trackingMode: 'batch', inventoryItemId: res.inventory_item_id, qty: res.qty,
      bomItemId: res.bom_item_id, jobCardId, username, existingAllocations: activeAllocations,
    });
  } else {
    await execute('UPDATE inventory_items SET on_hand = on_hand - ? WHERE id = ?', [res.qty, res.inventory_item_id]);
  }
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
  // Phase 3 (I7) — a batch-tracked reservation's allocations are a hold, never a physical
  // decrement (issueBatch only runs at Issue) — releasing is a pure status flip, no quantity to
  // "give back." The computed available-for-allocation figure self-heals the instant these rows
  // stop counting as 'active'.
  await execute("UPDATE inventory_batch_allocations SET status = 'released' WHERE reservation_id = ? AND status = 'active'", [reservationId]);

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
  // Phase 3 (I7) — serial-tracked reservations never create an inventory_reservations row (they
  // live directly on inventory_serials.status, mirroring stock_pieces), so the loop above can never
  // see them. Without this, cancelling a bom_item would leave a reserved serial orphaned forever —
  // held but pointing at a line that no longer needs it.
  const reservedSerials = await queryAll("SELECT id FROM inventory_serials WHERE bom_item_id = ? AND status = 'reserved'", [bomItemId]);
  for (const s of reservedSerials) await releaseSerial(s.id);
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
// `byId`/`unitCount` are optional — a loop caller processing many items in one project
// (matchProjectPlainStock) builds both maps once and passes them down to avoid re-querying
// bom_assemblies/projects per item; a single-item caller omits them and this self-fetches, scoped
// to the item's own project.
export async function autoReserveFromStock(bomItem, username = 'system', byId = null, unitCount = null) {
  if (!bomItem?.item_id) return { matched: 0 };
  if (DIMENSIONAL_CATEGORIES.includes(bomItem.category)) return { matched: 0 }; // remnant-match's territory

  const rollupById = byId || await getAssemblyRollupMap(bomItem.project_id);
  const effectiveUnitCount = unitCount ?? (await getProjectUnitCounts(bomItem.project_id)).get(bomItem.project_id) ?? 1;
  const requested = itemRollupQty(bomItem.qty_text, bomItem.assembly_id, rollupById, effectiveUnitCount, !!bomItem.qty_resolved) ?? 0;
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
  const placeholders = DIMENSIONAL_CATEGORIES.map(() => '?').join(',');
  const items = await queryAll(
    `SELECT * FROM bom_items WHERE project_id = ? AND pending_review = 0 AND item_id IS NOT NULL
       AND (category IS NULL OR category NOT IN (${placeholders}))`,
    [projectId, ...DIMENSIONAL_CATEGORIES]
  );
  // One rollup map (+ one project unit-count lookup) for the whole project, not one per item — a
  // Release BOM can process 100+ lines.
  const [rollupById, unitCounts] = await Promise.all([getAssemblyRollupMap(projectId), getProjectUnitCounts(projectId)]);
  // Number(...) matters here: projectId reaches this function as a route-param STRING when called
  // from release-bom/route.js (params.id is never auto-coerced by Next), but unitCounts' keys are
  // real DB-row integers — a bare `.get(projectId)` would silently miss and fall back to 1. Found
  // live: a real partial-match test came back matched=1 instead of the expected =50 until this fix.
  const unitCount = unitCounts.get(Number(projectId)) ?? 1;
  const results = [];
  for (const item of items) {
    const r = await autoReserveFromStock(item, username, rollupById, unitCount);
    if (r.matched > 0) results.push({ bomItemId: item.id, ...r });
  }
  return results;
}
