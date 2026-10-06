// A supplier's dispatch of goods against an issued PO: save it, and tell the people waiting for the goods.
// Entered by the supplier on their RFQ link or by Procurement; both go through here.
import { queryAll, queryOne, execute, withTransaction } from './db';
import { validateDispatch } from './po-dispatch.mjs';
import { advancePurchaseStatus } from './procurement';
import { notifyDepartment } from './notify';
import { audit } from './usb';
import { getLockedDispatchIds } from './data';
import { tabLink } from './alert-links.mjs';

export const DISPATCH_LOCKED = 'Stores has already received goods from this dispatch, so it can no longer be changed. Tell Procurement if something is wrong.';
export async function isDispatchLocked(poId, dispatchId) { return (await getLockedDispatchIds([poId])).has(Number(dispatchId)); }

const COLS = ['dispatched_on', 'transport_mode', 'dispatch_through', 'vehicle_no', 'carrier_doc_no', 'carrier_doc_date', 'container_no',
  'tracking_url', 'expected_delivery_date', 'invoice_no', 'invoice_date', 'eway_bill_no', 'notes'];

// What is still to go on each PO line (ordered minus what earlier dispatches carried). excludeId = a dispatch being edited.
export async function poItemBalances(poId, excludeId = null) {
  const rows = await queryAll(
    `SELECT pi.id, pi.description, pi.qty,
            COALESCE((SELECT SUM(di.qty) FROM po_dispatch_items di JOIN po_dispatches d ON d.id = di.dispatch_id
                       WHERE di.po_item_id = pi.id AND (? IS NULL OR d.id != ?)), 0) AS sent
       FROM po_items pi WHERE pi.po_id = ?`, [excludeId, excludeId, poId]);
  return new Map(rows.map(r => [r.id, { ordered: r.qty, sent: r.sent, remaining: Math.max(0, r.qty - r.sent), description: r.description }]));
}

async function tell(po, items, d, actor) {
  const bomIds = (await queryAll(
    `SELECT bom_item_id FROM po_items WHERE id IN (${items.map(() => '?').join(',')}) AND bom_item_id IS NOT NULL`, items.map(i => i.po_item_id))).map(r => r.bom_item_id);
  // Goods are on the way: Ordered -> Transit (forward-only, so a line already received is left alone).
  for (const id of bomIds) { try { await advancePurchaseStatus(id, 'Transit'); } catch { /* status stays as it was */ } }
  const note = {
    kind: 'supplier_dispatch', title: `Goods on the way - ${po.po_no}`,
    body: `${po.supplier_name || 'The supplier'} dispatched ${items.length} line${items.length === 1 ? '' : 's'}${d.dispatch_through ? ` with ${d.dispatch_through}` : ''}${d.carrier_doc_no ? ` (${d.carrier_doc_no})` : ''}${d.expected_delivery_date ? `, due ${d.expected_delivery_date}` : ''}.`,
    dedupe_key: `supplier_dispatch:${d.id}`,
  };
  try {
    await notifyDepartment('Stores', { ...note, link: tabLink('/stores', 'receive', { q: po.po_no }) });
    await notifyDepartment('Procurement', { ...note, link: tabLink('/procurement', 'orders', { q: po.po_no }) });
  } catch { /* best-effort */ }
  await audit('po_dispatch_added', { actor, detail: `${po.po_no} · ${items.length} line(s)${d.carrier_doc_no ? ` · ${d.carrier_doc_no}` : ''}` });
}

// po: { id, po_no, supplier_name }. actor: 'supplier:<id>' or a username.
export async function createPoDispatch(po, body, actor) {
  const v = validateDispatch(body, await poItemBalances(po.id));
  if (v.error) return { error: v.error };
  const id = await withTransaction(async tx => {
    const r = await tx.execute({
      sql: `INSERT INTO po_dispatches (po_id, ${COLS.join(', ')}, entered_by) VALUES (?, ${COLS.map(() => '?').join(', ')}, ?)`,
      args: [po.id, ...COLS.map(c => v.values[c]), actor] });
    const did = Number(r.lastInsertRowid);
    for (const it of v.items) await tx.execute({ sql: 'INSERT INTO po_dispatch_items (dispatch_id, po_item_id, qty) VALUES (?, ?, ?)', args: [did, it.po_item_id, it.qty] });
    return did;
  });
  await tell(po, v.items, { id, ...v.values }, actor);
  return { id };
}

// Edit one dispatch's details (and its lines, when sent).
export async function updatePoDispatch(po, dispatchId, body, actor) {
  const d = await queryOne('SELECT id FROM po_dispatches WHERE id = ? AND po_id = ?', [dispatchId, po.id]);
  if (!d) return { error: 'Dispatch not found', status: 404 };
  if (await isDispatchLocked(po.id, d.id)) return { error: DISPATCH_LOCKED, status: 409 };
  const v = validateDispatch(body, await poItemBalances(po.id, d.id), { requireItems: false });
  if (v.error) return { error: v.error };
  await withTransaction(async tx => {
    await tx.execute({ sql: `UPDATE po_dispatches SET ${COLS.map(c => `${c} = ?`).join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, args: [...COLS.map(c => v.values[c]), d.id] });
    if (v.items) {
      await tx.execute({ sql: 'DELETE FROM po_dispatch_items WHERE dispatch_id = ?', args: [d.id] });
      for (const it of v.items) await tx.execute({ sql: 'INSERT INTO po_dispatch_items (dispatch_id, po_item_id, qty) VALUES (?, ?, ?)', args: [d.id, it.po_item_id, it.qty] });
    }
  });
  await audit('po_dispatch_edited', { actor, detail: `${po.po_no} · dispatch ${d.id}` });
  return { id: d.id };
}
