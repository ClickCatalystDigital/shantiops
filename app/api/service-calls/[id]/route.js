// app/api/service-calls/[id]/route.js — field edits (assign, diagnose, resolve, priority/SLA) and
// status transitions on a service call. resolved_at/closed_at are stamped here, by the transition
// itself, so the SLA-aging report (item 38) always reads a real timestamp, never a hand-typed one.
import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { audit } from '@/lib/usb';

const STATUSES = ['open', 'assigned', 'in_progress', 'resolved', 'closed'];
const EDITABLE_FIELDS = ['customer_name', 'contact_person', 'contact_phone', 'subject', 'description',
  'priority', 'sla_hours', 'assigned_to', 'diagnosis', 'resolution', 'closure_evidence'];

export async function PATCH(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Installation');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Installation', 'installation.service_call.write');
  if (actionDenied) return actionDenied;

  const call = await queryOne('SELECT * FROM service_calls WHERE id = ?', [params.id]);
  if (!call) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const b = await req.json();
  const sets = [];
  const args = [];
  for (const f of EDITABLE_FIELDS) {
    if (f in b) { sets.push(`${f} = ?`); args.push(b[f] || null); }
  }
  if (b.status) {
    if (!STATUSES.includes(b.status)) return NextResponse.json({ error: 'Unknown status' }, { status: 400 });
    sets.push('status = ?'); args.push(b.status);
    if (b.status === 'resolved' && call.status !== 'resolved') sets.push('resolved_at = CURRENT_TIMESTAMP');
    if (b.status === 'closed' && call.status !== 'closed') sets.push('closed_at = CURRENT_TIMESTAMP');
  }
  if (!sets.length) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
  args.push(params.id);

  await execute(`UPDATE service_calls SET ${sets.join(', ')} WHERE id = ?`, args);
  await audit('service_call_updated', { actor: user.username, detail: `SC-${call.call_no}: ${Object.keys(b).join(',')}` });
  return NextResponse.json({ ok: true });
}
