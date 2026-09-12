// app/api/purchase-orders/[id]/delivery-lots/route.js

// PO Delivery Lots — Procurement's own expected-delivery scheduling per PO. Distinct from
// bom_item_expected_children (Stores' unit-routing reference, edit_lots action on the sibling
// route) — this works for any po_item, draft or issued PO, and a single lot can span several
// po_items/projects at once (one physical delivery covering multiple items/projects).
import { NextResponse } from 'next/server';
import { queryAll, queryOne, withTransaction } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { getPoDeliveryLots } from '@/lib/data';
import { audit } from '@/lib/usb';

export async function GET(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Procurement');
  if (denied) return denied;
  const po = await queryOne('SELECT id FROM purchase_orders WHERE id = ?', [params.id]);
  if (!po) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(await getPoDeliveryLots(po.id));
}

export async function POST(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Procurement');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Procurement', 'procurement.po.delivery_lots.write');
  if (actionDenied) return actionDenied;

  const po = await queryOne('SELECT id, po_no, status FROM purchase_orders WHERE id = ?', [params.id]);
  if (!po) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  // A draft PO's lines aren't a real commitment yet; a cancelled one never will be — delivery
  // scheduling is only meaningful once the PO is actually issued to the supplier.
  if (po.status !== 'issued') {
    return NextResponse.json({ error: 'Only an issued PO can have delivery lots scheduled' }, { status: 400 });
  }

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

  // Trust-boundary + over-allocation + child-project checks, all before any write — a client
  // can't submit a po_item_id belonging to a different PO, over-schedule a line beyond its own
  // qty, or tag a "child unit" that isn't actually a real child of that item's project.
  for (const it of items) {
    const line = await queryOne('SELECT id, qty, project_id FROM po_items WHERE id = ? AND po_id = ?', [it.po_item_id, po.id]);
    if (!line) return NextResponse.json({ error: `Item ${it.po_item_id} is not on this PO` }, { status: 400 });
    const existing = (await queryOne(
      'SELECT COALESCE(SUM(qty),0) AS q FROM po_delivery_lot_items WHERE po_item_id = ?', [it.po_item_id]
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

  const label = String(b.lot_label || '1').trim() || '1';
  let lotId;
  await withTransaction(async tx => {
    const lotRes = await tx.execute({
      sql: 'INSERT INTO po_delivery_lots (po_id, lot_label, expected_delivery_date, notes, created_by) VALUES (?, ?, ?, ?, ?)',
      args: [po.id, label, b.expected_delivery_date, b.notes || null, user.username],
    });
    lotId = Number(lotRes.lastInsertRowid);
    for (const it of items) {
      const liRes = await tx.execute({
        sql: 'INSERT INTO po_delivery_lot_items (lot_id, po_item_id, qty) VALUES (?, ?, ?)',
        args: [lotId, it.po_item_id, it.qty],
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

  await audit('po_delivery_lot_created', { actor: user.username, detail: `${po.po_no}: lot ${label} -> ${items.length} item(s), due ${b.expected_delivery_date}` });
  return NextResponse.json({ ok: true, id: lotId });
}
