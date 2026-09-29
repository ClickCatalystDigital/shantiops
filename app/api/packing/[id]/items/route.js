import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';

export async function POST(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Dispatch');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Dispatch', 'dispatch.packing.edit');
  if (actionDenied) return actionDenied;
  const b = await req.json();
  if (!b.material_description?.trim()) {
    return NextResponse.json({ error: 'Item description is required' }, { status: 400 });
  }
  const max = await queryOne(
    'SELECT COALESCE(MAX(s_no), 0) AS n FROM packing_items WHERE packing_list_id = ?', [params.id]
  );
  const r = await execute(
    `INSERT INTO packing_items
       (packing_list_id, s_no, material_description, moc, size_spec, ibr_no, item_code, box_no, qty, unit, make)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [params.id, max.n + 1, b.material_description.trim(), b.moc || null, b.size_spec || null,
     b.ibr_no || null, b.item_code || null, b.box_no || null, Number(b.qty) || 1, b.unit || "No's", b.make || null]
  );
  return NextResponse.json({ id: Number(r.lastId) });
}

// Inline edit of a line (Dispatch types IBR no, item code, box/package, section, etc.).
const ITEM_EDITABLE = ['material_description', 'moc', 'size_spec', 'ibr_no', 'item_code', 'box_no', 'section', 'make', 'unit', 'qty'];
export async function PATCH(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Dispatch');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Dispatch', 'dispatch.packing.edit');
  if (actionDenied) return actionDenied;
  const b = await req.json();
  const itemId = Number(b.itemId);
  const keys = ITEM_EDITABLE.filter(k => k in b);
  if (!itemId || !keys.length) return NextResponse.json({ error: 'itemId and a field required' }, { status: 400 });
  if ('material_description' in b && !String(b.material_description).trim()) return NextResponse.json({ error: 'Description is required' }, { status: 400 });
  if ('qty' in b && !(Number(b.qty) > 0)) return NextResponse.json({ error: 'Qty must be positive' }, { status: 400 });
  const vals = keys.map(k => k === 'qty' ? Number(b[k]) : (String(b[k] ?? '').trim() || null));
  const r = await execute(`UPDATE packing_items SET ${keys.map(k => `${k} = ?`).join(', ')} WHERE id = ? AND packing_list_id = ?`, [...vals, itemId, params.id]);
  if (!r.changes) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Dispatch');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Dispatch', 'dispatch.packing.edit');
  if (actionDenied) return actionDenied;
  const itemId = new URL(req.url).searchParams.get('itemId');
  if (!itemId) return NextResponse.json({ error: 'itemId required' }, { status: 400 });
  await execute('DELETE FROM packing_items WHERE id = ?', [itemId]);
  return NextResponse.json({ ok: true });
}
