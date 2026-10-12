import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { audit } from '@/lib/usb';

const STATUSES = ['open', 'accepted', 'rejected', 'closed'];

export async function PATCH(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Sales');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Sales', 'sales.trade_request.write');
  if (actionDenied) return actionDenied;

  const { id } = await params;
  const row = await queryOne('SELECT id, tr_no FROM trade_requests WHERE id = ?', [id]);
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const b = await req.json();
  if (!STATUSES.includes(b.status)) return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
  await execute('UPDATE trade_requests SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [b.status, id]);
  await audit('trade_request_status', { actor: user.username, detail: `${row.tr_no} -> ${b.status}` });
  return NextResponse.json({ ok: true });
}
