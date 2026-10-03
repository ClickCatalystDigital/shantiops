// One service expense request — read, and the approval chain actions.
import { NextResponse } from 'next/server';
import { execute } from '@/lib/db';
import { getFreshSessionUser, canAccessDepartment, isPM } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { audit } from '@/lib/usb';
import { getRequest, canView, notifyRole, notifyRequester } from '@/lib/service-expenses';
import { notifyDepartment } from '@/lib/notify';

export async function GET(_req, { params }) {
  const user = await getFreshSessionUser();
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const r = await getRequest(Number(params.id));
  if (!r) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!canView(user, r)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  return NextResponse.json(r);
}

// Which statuses each action may start from, who may take it, and where it leads.
const STEPS = {
  manager_approve: { from: 'pending_manager', roles: ['manager', 'admin'], to: 'pending_executive', who: 'manager' },
  manager_reject: { from: 'pending_manager', roles: ['manager', 'admin'], to: 'rejected', who: 'manager' },
  executive_approve: { from: 'pending_executive', roles: ['executive', 'admin'], to: 'with_accounts', who: 'executive' },
  executive_reject: { from: 'pending_executive', roles: ['executive', 'admin'], to: 'rejected', who: 'executive' },
};

export async function PATCH(req, { params }) {
  const user = await getFreshSessionUser();
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const id = Number(params.id);
  const r = await getRequest(id);
  if (!r) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const b = await req.json();
  const note = String(b.note || '').trim() || null;

  if (b.action === 'settle') {
    if (!canAccessDepartment(user, 'Accounts')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const denied = await requireAction(user, 'Accounts', 'accounts.service_expense.settle');
    if (denied) return denied;
    if (r.status !== 'with_accounts') return NextResponse.json({ error: `Request is ${r.status}` }, { status: 409 });
    const settledOn = /^\d{4}-\d{2}-\d{2}$/.test(b.settled_on || '') ? b.settled_on : null;
    if (!settledOn) return NextResponse.json({ error: 'Settled-on date is required' }, { status: 400 });
    await execute(`UPDATE service_expense_requests SET status='settled', settled_on=?, accounted_by=?, checked_by=? WHERE id=? AND status='with_accounts'`,
      [settledOn, String(b.accounted_by || user.display_name || user.username).trim(), String(b.checked_by || '').trim() || null, id]);
    await audit('service_expense_settled', { actor: user.username, detail: r.req_no });
    try { await notifyRequester(r, { kind: 'service_expense', title: `${r.req_no} settled by Accounts`, dedupe_key: `svcexp:${id}:settled` }); } catch { /* best effort */ }
    return NextResponse.json({ ok: true });
  }

  const step = STEPS[b.action];
  if (!step) return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  if (!step.roles.includes(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (r.status !== step.from) return NextResponse.json({ error: `Request is ${r.status}` }, { status: 409 });
  const rejecting = step.to === 'rejected';
  if (rejecting && !note) return NextResponse.json({ error: 'A reason is required to reject' }, { status: 400 });

  const by = user.display_name || user.username;
  const sql = rejecting
    ? `UPDATE service_expense_requests SET status='rejected', rejected_stage=?, rejected_note=?, ${step.who}_by=?, ${step.who}_at=CURRENT_TIMESTAMP, ${step.who}_note=? WHERE id=? AND status=?`
    : `UPDATE service_expense_requests SET status=?, ${step.who}_by=?, ${step.who}_at=CURRENT_TIMESTAMP, ${step.who}_note=? WHERE id=? AND status=?`;
  const args = rejecting ? [step.who, note, by, note, id, step.from] : [step.to, by, note, id, step.from];
  const res = await execute(sql, args);
  if (!res.changes) return NextResponse.json({ error: 'Request was just updated by someone else' }, { status: 409 });
  // A rejected travel claim gives the cash it had taken as advance back (remaining only counts non-rejected claims).
  await audit(`service_expense_${b.action}`, { actor: user.username, detail: `${r.req_no}${note ? `: ${note}` : ''}` });
  try {
    if (rejecting) await notifyRequester(r, { kind: 'service_expense', title: `${r.req_no} rejected by ${by}`, body: note, dedupe_key: `svcexp:${id}:rej` });
    else if (step.to === 'pending_executive') await notifyRole(['executive'], { kind: 'service_expense', title: `${r.req_no} approved by PM ${by}`, body: `${r.requester_name} · ₹${r.amount}`, dedupe_key: `svcexp:${id}:exec` });
    else {
      await notifyDepartment('Accounts', { kind: 'service_expense', title: `${r.req_no} approved — ready for Accounts`, body: `${r.requester_name} · ₹${r.amount}`, dedupe_key: `svcexp:${id}:acct` });
      await notifyRequester(r, { kind: 'service_expense', title: `${r.req_no} approved`, dedupe_key: `svcexp:${id}:ok` });
    }
  } catch { /* best effort */ }
  return NextResponse.json({ ok: true });
}
