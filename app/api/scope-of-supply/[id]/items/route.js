// app/api/scope-of-supply/[id]/items/route.js — add a line item to a Scope of Supply document
// (SL/Product/Qty/Unit Price/Basic Value on the real Order Acknowledgement layout).
import { NextResponse } from 'next/server';
import { execute, queryOne, queryAll } from '@/lib/db';
import { getFreshSessionUser, canAccessDepartment } from '@/lib/auth';

function canEdit(user) {
  return canAccessDepartment(user, 'Design') || canAccessDepartment(user, 'Engineering');
}

export async function POST(req, { params }) {
  const user = await getFreshSessionUser();
  if (!canEdit(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const header = await queryOne('SELECT id FROM scope_of_supply WHERE id = ?', [params.id]);
  if (!header) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const b = await req.json();
  const description = String(b.description || '').trim();
  if (!description) return NextResponse.json({ error: 'Description is required' }, { status: 400 });

  const qty = b.qty === '' || b.qty == null ? null : Number(b.qty);
  const unitPrice = b.unit_price === '' || b.unit_price == null ? null : Number(b.unit_price);
  // Basic value defaults to qty × unit price, same as the reference document — an explicit
  // amount always wins (a line can be priced as a lump sum with no meaningful per-unit rate).
  const amount = b.amount !== undefined && b.amount !== '' ? Number(b.amount) : (qty != null && unitPrice != null ? qty * unitPrice : null);

  const maxRow = await queryOne('SELECT MAX(sort_order) AS m FROM scope_of_supply_items WHERE scope_of_supply_id = ?', [params.id]);
  const { lastId } = await execute(
    `INSERT INTO scope_of_supply_items (scope_of_supply_id, description, spec, qty, uom, unit_price, amount, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [params.id, description, b.spec?.trim() || null, qty, b.uom?.trim() || null, unitPrice, amount, (maxRow?.m ?? -1) + 1]
  );
  return NextResponse.json({ id: Number(lastId) });
}

export async function GET(req, { params }) {
  const user = await getFreshSessionUser();
  if (!canEdit(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  return NextResponse.json(await queryAll('SELECT * FROM scope_of_supply_items WHERE scope_of_supply_id = ? ORDER BY sort_order, id', [params.id]));
}
