// app/api/sale-orders/route.js — V2-CHANGES.md Group 6 Phase 6.1 (D14). Free-text Sale Order
// numbers Sales maintains; Stores references one via ?search= when raising a source='sas' request
// (Phase 6.4). Mirrors app/api/suppliers/route.js's shape.
import { NextResponse } from 'next/server';
import { execute, queryAll } from '@/lib/db';
import { getFreshSessionUser, isInternal, requireDepartment } from '@/lib/auth';
import { getSaleOrders } from '@/lib/data';
import { audit } from '@/lib/usb';

export async function GET(req) {
  const user = await getFreshSessionUser();
  if (!isInternal(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const search = new URL(req.url).searchParams.get('search');
  if (search) {
    const rows = await queryAll(
      "SELECT * FROM sale_orders WHERE so_no LIKE ? ORDER BY created_at DESC LIMIT 20",
      [`%${search}%`]
    );
    return NextResponse.json(rows);
  }
  return NextResponse.json(await getSaleOrders());
}

export async function POST(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Sales');
  if (denied) return denied;

  const b = await req.json();
  const soNo = String(b.so_no || '').trim();
  if (!soNo) return NextResponse.json({ error: 'Sale Order number is required' }, { status: 400 });

  const { lastId } = await execute(
    'INSERT INTO sale_orders (so_no, customer_name, description, created_by) VALUES (?, ?, ?, ?)',
    [soNo, b.customer_name || null, b.description || null, user.username]
  );
  await audit('sale_order_created', { actor: user.username, detail: soNo });
  return NextResponse.json({ id: Number(lastId) });
}
