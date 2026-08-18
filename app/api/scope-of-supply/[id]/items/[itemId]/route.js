import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, canAccessDepartment } from '@/lib/auth';

function canEdit(user) {
  return canAccessDepartment(user, 'Design') || canAccessDepartment(user, 'Engineering');
}

export async function PATCH(req, { params }) {
  const user = await getFreshSessionUser();
  if (!canEdit(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const item = await queryOne('SELECT * FROM scope_of_supply_items WHERE id = ? AND scope_of_supply_id = ?', [params.itemId, params.id]);
  if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const b = await req.json();
  const next = {
    description: b.description !== undefined ? String(b.description).trim() : item.description,
    spec: b.spec !== undefined ? (b.spec?.trim() || null) : item.spec,
    qty: b.qty !== undefined ? (b.qty === '' ? null : Number(b.qty)) : item.qty,
    uom: b.uom !== undefined ? (b.uom?.trim() || null) : item.uom,
    unit_price: b.unit_price !== undefined ? (b.unit_price === '' ? null : Number(b.unit_price)) : item.unit_price,
  };
  // Same "explicit amount wins, otherwise qty × unit price" default the create route uses.
  next.amount = b.amount !== undefined ? (b.amount === '' ? null : Number(b.amount))
    : (next.qty != null && next.unit_price != null ? next.qty * next.unit_price : item.amount);
  if (!next.description) return NextResponse.json({ error: 'Description cannot be empty' }, { status: 400 });

  await execute(
    'UPDATE scope_of_supply_items SET description = ?, spec = ?, qty = ?, uom = ?, unit_price = ?, amount = ? WHERE id = ?',
    [next.description, next.spec, next.qty, next.uom, next.unit_price, next.amount, params.itemId]
  );
  return NextResponse.json({ ok: true });
}

export async function DELETE(req, { params }) {
  const user = await getFreshSessionUser();
  if (!canEdit(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const item = await queryOne('SELECT id FROM scope_of_supply_items WHERE id = ? AND scope_of_supply_id = ?', [params.itemId, params.id]);
  if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  await execute('DELETE FROM scope_of_supply_items WHERE id = ?', [params.itemId]);
  return NextResponse.json({ ok: true });
}
