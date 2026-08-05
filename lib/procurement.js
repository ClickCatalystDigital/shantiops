// lib/procurement.js — write-side helpers shared by the Procurement redesign's API routes
// (PROCUREMENT-CHANGES.md §4.2). Split out from lib/data.js (read-only getters) since these mutate.

import { execute, queryOne, queryAll, nextCounterValue } from './db';

// V2-CHANGES.md Phase 5.1 — purchase_status now gets written forward by the real actions that
// earn it, instead of only being inferred for display (lib/data.js's deriveActiveStage). Forward-
// only: never regresses an item that's already further along (a second quote coming in after
// selection shouldn't knock it back to Comparison), and never touches Cancelled/In-Stock (terminal,
// reached only via the cancel flow or a manual override — this helper has no business there).
const STATUS_RANK = { Enquiry: 0, Comparison: 1, Ordered: 2, Transit: 3, Received: 4 };

export async function advancePurchaseStatus(bomItemId, target) {
  const targetRank = STATUS_RANK[target];
  if (targetRank == null) return; // not a rank-tracked status (Cancelled/In-Stock) — never auto-set
  const item = await queryOne('SELECT purchase_status FROM bom_items WHERE id = ?', [bomItemId]);
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
