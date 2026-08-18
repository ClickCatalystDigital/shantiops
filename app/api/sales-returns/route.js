// app/api/sales-returns/route.js — STERP "Sales Returns" (SYSTEM.md §5e). Sales-owned, same
// gating shape as app/api/suppliers/route.js — a single department's own record, not the dual
// Sales/Marketing CRM gate quotations/customers use.
import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, requireDepartment, isInternal } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { getSalesReturns } from '@/lib/data';
import { audit } from '@/lib/usb';

export async function GET() {
  const user = await getFreshSessionUser();
  if (!isInternal(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  return NextResponse.json(await getSalesReturns());
}

export async function POST(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Sales');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Sales', 'sales.return.write');
  if (actionDenied) return actionDenied;

  const b = await req.json();
  const description = String(b.item_description || '').trim();
  if (!b.sale_order_id) return NextResponse.json({ error: 'Sale Order is required' }, { status: 400 });
  if (!description) return NextResponse.json({ error: 'Item description is required' }, { status: 400 });
  const qty = Number(b.qty);
  if (!(qty > 0)) return NextResponse.json({ error: 'Quantity must be a positive number' }, { status: 400 });

  const so = await queryOne('SELECT id FROM sale_orders WHERE id = ?', [b.sale_order_id]);
  if (!so) return NextResponse.json({ error: 'Sale Order not found' }, { status: 404 });

  const { lastId } = await execute(
    `INSERT INTO sales_returns (sale_order_id, item_description, qty, reason, created_by)
     VALUES (?, ?, ?, ?, ?)`,
    [b.sale_order_id, description, qty, b.reason || null, user.username]
  );
  await audit('sales_return_created', { actor: user.username, detail: `SO ${b.sale_order_id}: ${description}` });
  return NextResponse.json({ id: Number(lastId) });
}
