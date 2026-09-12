// app/api/purchase-orders/[id]/delivery-lots/[lotId]/route.js

// Edit or remove one PO Delivery Lot — see the sibling route.js for the create side and the
// overall feature's reasoning.
import { NextResponse } from 'next/server';
import { execute, queryAll, queryOne, withTransaction } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { audit } from '@/lib/usb';

export async function PATCH(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Procurement');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Procurement', 'procurement.po.delivery_lots.write');
  if (actionDenied) return actionDenied;

  const po = await queryOne('SELECT id, po_no, status FROM purchase_orders WHERE id = ?', [params.id]);
  if (!po) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  // Same rule as create — see route.js. A lot created while issued, then left in place across a
  // Cancel Issue back to draft, still can't be edited until the PO is issued again (DELETE below
  // stays unrestricted — removing a stale entry is always safe).
  if (po.status !== 'issued') {
    return NextResponse.json({ error: 'Only an issued PO can have delivery lots scheduled' }, { status: 400 });
  }
  const lot = await queryOne('SELECT id, lot_label FROM po_delivery_lots WHERE id = ? AND po_id = ?', [params.lotId, po.id]);
  if (!lot) return NextResponse.json({ error: 'Lot not found on this PO' }, { status: 404 });

  const b = await req.json();
  if (!b.expected_delivery_date) {
    return NextResponse.json({ error: 'Expected delivery date is required' }, { status: 400 });
  }
  const rawItems = Array.isArray(b.items) ? b.items : [];
  const items = rawItems
    .map(i => ({
      po_item_id: Number(i.po_item_id),
      qty: Number(i.qty),
      child_project_ids: Array.isArray(i.child_project_ids) ? [...new Set(i.child_project_ids.map(Number).filter(Boolean))] : [],
    }))
    .filter(i => i.po_item_id > 0 && i.qty > 0);
  if (!items.length) {
    return NextResponse.json({ error: 'Add at least one item with a quantity' }, { status: 400 });
  }

  for (const it of items) {
    const line = await queryOne('SELECT id, qty, project_id FROM po_items WHERE id = ? AND po_id = ?', [it.po_item_id, po.id]);
    if (!line) return NextResponse.json({ error: `Item ${it.po_item_id} is not on this PO` }, { status: 400 });
    // Excludes this lot's own existing rows — the point of editing is to change what THIS lot
    // holds, so its prior allocation shouldn't count against the new total.
    const existing = (await queryOne(
      'SELECT COALESCE(SUM(qty),0) AS q FROM po_delivery_lot_items WHERE po_item_id = ? AND lot_id != ?', [it.po_item_id, lot.id]
    ))?.q || 0;
    if (existing + it.qty > line.qty + 1e-6) {
      const remaining = Math.round((line.qty - existing) * 1e6) / 1e6;
      return NextResponse.json({ error: `Line ${it.po_item_id}: only ${remaining} left to schedule` }, { status: 400 });
    }
    if (it.child_project_ids.length) {
      const placeholders = it.child_project_ids.map(() => '?').join(',');
      const validChildren = await queryAll(
        `SELECT id FROM projects WHERE master_project_id = ? AND id IN (${placeholders})`,
        [line.project_id, ...it.child_project_ids]
      );
      if (validChildren.length !== it.child_project_ids.length) {
        return NextResponse.json({ error: `Line ${it.po_item_id}: one or more selected units aren't children of this line's project` }, { status: 400 });
      }
    }
  }

  const label = String(b.lot_label || lot.lot_label || '1').trim() || '1';
  await withTransaction(async tx => {
    await tx.execute({
      sql: 'UPDATE po_delivery_lots SET lot_label = ?, expected_delivery_date = ?, notes = ? WHERE id = ?',
      args: [label, b.expected_delivery_date, b.notes || null, lot.id],
    });
    // Full replace — delete-then-reinsert, same idiom the sibling bom_item_expected_children
    // edit_lots action already uses. po_delivery_lot_item_children cascades off this delete.
    await tx.execute({ sql: 'DELETE FROM po_delivery_lot_items WHERE lot_id = ?', args: [lot.id] });
    for (const it of items) {
      const liRes = await tx.execute({
        sql: 'INSERT INTO po_delivery_lot_items (lot_id, po_item_id, qty) VALUES (?, ?, ?)',
        args: [lot.id, it.po_item_id, it.qty],
      });
      const lotItemId = Number(liRes.lastInsertRowid);
      for (const childId of it.child_project_ids) {
        await tx.execute({
          sql: 'INSERT INTO po_delivery_lot_item_children (lot_item_id, child_project_id) VALUES (?, ?)',
          args: [lotItemId, childId],
        });
      }
    }
  });

  await audit('po_delivery_lot_edited', { actor: user.username, detail: `${po.po_no}: lot ${label} -> ${items.length} item(s), due ${b.expected_delivery_date}` });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Procurement');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Procurement', 'procurement.po.delivery_lots.write');
  if (actionDenied) return actionDenied;

  const po = await queryOne('SELECT id, po_no FROM purchase_orders WHERE id = ?', [params.id]);
  if (!po) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const lot = await queryOne('SELECT id, lot_label FROM po_delivery_lots WHERE id = ? AND po_id = ?', [params.lotId, po.id]);
  if (!lot) return NextResponse.json({ error: 'Lot not found on this PO' }, { status: 404 });

  // Deliberately no cancelled-PO block here — removing a now-irrelevant schedule entry is harmless
  // cleanup regardless of the PO's own status.
  await execute('DELETE FROM po_delivery_lots WHERE id = ?', [lot.id]);

  await audit('po_delivery_lot_deleted', { actor: user.username, detail: `${po.po_no}: lot ${lot.lot_label} removed` });
  return NextResponse.json({ ok: true });
}
