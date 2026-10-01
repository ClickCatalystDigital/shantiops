import { NextResponse } from 'next/server';
import { execute, queryOne, queryAll, withTransaction } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { normalizePackType, PACK_TYPE_LABEL } from '@/lib/packing-forms.mjs';
import { normalizeList } from '@/lib/packing-layout';

// A dispatched list is a real record: its lines are no longer edited, added or removed here.
async function openList(listId) {
  const pl = await queryOne('SELECT id, status, layout, master_section FROM packing_lists WHERE id = ?', [listId]);
  if (!pl) return { error: NextResponse.json({ error: 'Not found' }, { status: 404 }) };
  if (pl.status === 'dispatched') return { error: NextResponse.json({ error: 'This list is already dispatched and can no longer be edited.' }, { status: 409 }) };
  return { pl };
}
const itemsOf = listId => queryAll('SELECT * FROM packing_items WHERE packing_list_id = ? ORDER BY sort_order, id', [listId]);

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
  const { pl, error } = await openList(params.id);
  if (error) return error;
  if (pl.layout === 'combined') {
    // A line typed in by Dispatch: goes into the chosen group (or its own new one) of the chosen section.
    const rows = await queryAll('SELECT section, group_label, pack_type, sort_order FROM packing_items WHERE packing_list_id = ?', [params.id]);
    const sample = b.group_label ? rows.find(r => r.group_label === b.group_label) : null;
    const type = sample?.pack_type || normalizePackType(b.pack_type) || 'package';
    const label = sample ? b.group_label : (String(b.group_label || '').trim() || PACK_TYPE_LABEL[type]);
    const section = sample?.section ?? (b.section || rows[0]?.section || null);
    const maxOrder = Math.max(0, ...rows.map(r => r.sort_order ?? 0));
    const id = await withTransaction(async tx => {
      const r = await tx.execute({ sql: `INSERT INTO packing_items (packing_list_id, line_kind, section, pack_type, group_label, box_no, material_description, moc, size_spec, ibr_no, item_code, qty, unit, make, sort_order)
        VALUES (?, 'manual', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [params.id, section, type, label, label, b.material_description.trim(), b.moc || null, b.size_spec || null, b.ibr_no || null, b.item_code || null,
          Number(b.qty) || 1, b.unit || "No's", b.make || null, maxOrder + 1] });
      await normalizeList(tx, params.id, pl.master_section);
      return Number(r.lastInsertRowid);
    });
    return NextResponse.json({ id, items: await itemsOf(params.id) });
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

export async function DELETE(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Dispatch');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Dispatch', 'dispatch.packing.edit');
  if (actionDenied) return actionDenied;
  const itemId = new URL(req.url).searchParams.get('itemId');
  if (!itemId) return NextResponse.json({ error: 'itemId required' }, { status: 400 });
  const { pl, error } = await openList(params.id);
  if (error) return error;
  // Only a line of THIS list; size / serial rows hanging under it go with it.
  const own = await queryOne('SELECT id FROM packing_items WHERE id = ? AND packing_list_id = ?', [itemId, params.id]);
  if (!own) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  await withTransaction(async tx => {
    await tx.execute({ sql: 'DELETE FROM packing_items WHERE parent_item_id = ? AND packing_list_id = ?', args: [itemId, params.id] });
    await tx.execute({ sql: 'DELETE FROM packing_items WHERE id = ? AND packing_list_id = ?', args: [itemId, params.id] });
    if (pl.layout === 'combined') await normalizeList(tx, params.id, pl.master_section);
  });
  return NextResponse.json({ ok: true, items: pl.layout === 'combined' ? await itemsOf(params.id) : undefined });
}
