// lib/procurement.js — write-side helpers shared by the Procurement redesign's API routes
// (PROCUREMENT-CHANGES.md §4.2). Split out from lib/data.js (read-only getters) since these mutate.

import { execute, queryOne, queryAll, nextCounterValue } from './db';

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
