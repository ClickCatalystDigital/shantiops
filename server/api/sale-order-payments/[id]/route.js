// app/api/sale-order-payments/[id]/route.js — correct or remove a logged payment. Every change is
// audit-logged with old → new values (the log is money data; a silent edit would defeat it).
import { hiddenSalesRecord } from '@/lib/sales-visibility';
import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, requireDepartment, isPM } from '@/lib/auth';
import { requireAction, requireSalesOrAccountsAction } from '@/lib/action-permissions';
import { isPaymentType } from '@/lib/payment-types.mjs';
import { audit } from '@/lib/usb';

async function guard() {
  const user = await getFreshSessionUser();
  const actionDenied = await requireSalesOrAccountsAction(user, 'sales.payment.write');
  return actionDenied ? { denied: actionDenied } : { user };
}

const load = id => queryOne(
  `SELECT p.*, so.so_no FROM sale_order_payments p JOIN sale_orders so ON so.id = p.sale_order_id WHERE p.id = ?`, [id]);

export async function PATCH(req, props) {
  const params = await props.params;
  const { user, denied } = await guard();
  if (denied) return denied;
  const hidden = await hiddenSalesRecord(user, 'payment', params.id); // plan 2a: own records only
  if (hidden) return hidden;
  const before = await load(params.id);
  if (!before) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const b = await req.json();
  const set = {};
  if (b.amount !== undefined) {
    const amount = Number(b.amount);
    if (!(amount > 0)) return NextResponse.json({ error: 'Amount must be a positive number' }, { status: 400 });
    set.amount = amount;
  }
  if (b.received_on !== undefined) {
    if (b.received_on && !/^\d{4}-\d{2}-\d{2}$/.test(b.received_on)) return NextResponse.json({ error: 'Invalid date' }, { status: 400 });
    set.received_on = b.received_on || null; // blank = date unknown
  }
  if (b.payment_type !== undefined) {
    if (b.payment_type && !isPaymentType(b.payment_type)) return NextResponse.json({ error: 'Unknown payment type' }, { status: 400 });
    set.payment_type = b.payment_type || null;
  }
  for (const key of ['mode', 'remark', 'invoice_ref']) {
    if (b[key] !== undefined) set[key] = String(b[key]).trim() || null;
  }
  const changed = Object.entries(set).filter(([c, v]) => String(before[c] ?? '') !== String(v ?? ''));
  if (!changed.length) return NextResponse.json({ ok: true });

  await execute(`UPDATE sale_order_payments SET ${changed.map(([c]) => `${c} = ?`).join(', ')} WHERE id = ?`, [...changed.map(([, v]) => v), params.id]);
  await audit('sale_payment_edit', { actor: user.username, detail: `${before.so_no} payment #${before.id}: ${changed.map(([c, v]) => `${c} ${before[c] ?? '—'} → ${v ?? '—'}`).join('; ')}` });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req, props) {
  const params = await props.params;
  const { user, denied } = await guard();
  if (denied) return denied;
  const hidden = await hiddenSalesRecord(user, 'payment', params.id); // plan 2a: own records only
  if (hidden) return hidden;
  const before = await load(params.id);
  if (!before) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  await execute('DELETE FROM sale_order_payments WHERE id = ?', [params.id]);
  await audit('sale_payment_deleted', { actor: user.username, detail: `${before.so_no} payment #${before.id}: ${before.amount} on ${before.received_on ?? 'no date'} (${before.mode ?? 'no mode'})` });
  return NextResponse.json({ ok: true });
}
