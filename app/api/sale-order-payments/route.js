// app/api/sale-order-payments/route.js — Sales Payment Tracker log (lib/db.js sale_order_payments).
// Append-only by design (no PATCH/DELETE): it's a log; a wrong entry is corrected by Accounts.
import { NextResponse } from 'next/server';
import { execute, queryAll, queryOne } from '@/lib/db';
import { getFreshSessionUser, requireDepartment, isPM, isInternal } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { audit } from '@/lib/usb';

// Scoped read — the PO wizard's own embedded Payment Collection section (Phase 2.5) needs this
// one Sale Order's own log without pulling the whole page-level getSalePayments() list.
export async function GET(req) {
  const user = await getFreshSessionUser();
  if (!isInternal(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const soId = new URL(req.url).searchParams.get('sale_order_id');
  if (!soId) return NextResponse.json({ error: 'sale_order_id is required' }, { status: 400 });
  return NextResponse.json(await queryAll('SELECT * FROM sale_order_payments WHERE sale_order_id = ? ORDER BY received_on DESC, id DESC', [soId]));
}

export async function POST(req) {
  const user = await getFreshSessionUser();
  if (!isPM(user)) {
    const denied = requireDepartment(user, 'Sales');
    if (denied) return denied;
  }
  const actionDenied = await requireAction(user, 'Sales', 'sales.payment.write');
  if (actionDenied) return actionDenied;

  const b = await req.json();
  const amount = Number(b.amount);
  if (!(amount > 0)) return NextResponse.json({ error: 'Amount must be a positive number' }, { status: 400 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.received_on || '')) return NextResponse.json({ error: 'Payment date is required' }, { status: 400 });
  const so = await queryOne('SELECT id, status FROM sale_orders WHERE id = ?', [b.sale_order_id]);
  if (!so) return NextResponse.json({ error: 'Sale Order not found' }, { status: 404 });
  if (so.status === 'cancelled') return NextResponse.json({ error: 'This Sale Order is cancelled' }, { status: 400 });
  // An invoice pointer must belong to the same order — never trust a client-supplied id blindly.
  if (b.sales_invoice_id) {
    const inv = await queryOne('SELECT id FROM sales_invoices WHERE id = ? AND sale_order_id = ?', [b.sales_invoice_id, so.id]);
    if (!inv) return NextResponse.json({ error: 'Invoice does not belong to this Sale Order' }, { status: 400 });
  }

  const { lastId } = await execute(
    `INSERT INTO sale_order_payments (sale_order_id, sales_invoice_id, received_on, mode, amount, remark, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [so.id, b.sales_invoice_id || null, b.received_on, b.mode || null, amount, String(b.remark || '').trim() || null, user.username]
  );
  await audit('sale_payment_logged', { actor: user.username, detail: `SO ${so.id}: ${amount}` });
  return NextResponse.json({ ok: true, id: Number(lastId) });
}
