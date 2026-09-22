// app/api/sales-targets/[id]/route.js — a target is a plain editable number, not an append-only
// log (unlike most masters in this app), so DELETE is fine here.
import { NextResponse } from 'next/server';
import { execute } from '@/lib/db';
import { getFreshSessionUser } from '@/lib/auth';
import { requireCrmAction } from '@/lib/action-permissions';
import { audit } from '@/lib/usb';

export async function PATCH(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = await requireCrmAction(user, 'sales.target.write');
  if (denied) return denied;

  const b = await req.json();
  if (b.target_amount === undefined) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
  const targetAmount = Number(b.target_amount);
  if (!Number.isFinite(targetAmount) || targetAmount < 0) {
    return NextResponse.json({ error: 'Target amount must be a non-negative number' }, { status: 400 });
  }
  await execute('UPDATE sales_targets SET target_amount = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [targetAmount, params.id]);
  await audit('sales_target_edited', { actor: user.username, detail: `target #${params.id} — ${targetAmount}` });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req, { params }) {
  const user = await getFreshSessionUser();
  const denied = await requireCrmAction(user, 'sales.target.write');
  if (denied) return denied;

  await execute('DELETE FROM sales_targets WHERE id = ?', [params.id]);
  await audit('sales_target_deleted', { actor: user.username, detail: `target #${params.id}` });
  return NextResponse.json({ ok: true });
}
