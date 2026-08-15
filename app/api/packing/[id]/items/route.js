import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';

export async function POST(req, { params }) {
  const denied = requireDepartment(await getFreshSessionUser(), 'Dispatch');
  if (denied) return denied;
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

export async function DELETE(req) {
  const denied = requireDepartment(await getFreshSessionUser(), 'Dispatch');
  if (denied) return denied;
  const itemId = new URL(req.url).searchParams.get('itemId');
  if (!itemId) return NextResponse.json({ error: 'itemId required' }, { status: 400 });
  await execute('DELETE FROM packing_items WHERE id = ?', [itemId]);
  return NextResponse.json({ ok: true });
}
