// app/api/service-calls/route.js — STERP item 36. Customer complaints/service calls: priority,
// SLA target, assignment, diagnosis, resolution, and (via the [id]/visits sub-route) visit history.
// GET is isInternal-gated (same reasoning as GIR/Gate Pass — other departments, e.g. Sales, may
// need to see open complaints against a project they sold), writes are Installation-only.
import { NextResponse } from 'next/server';
import { execute, nextCounterValue } from '@/lib/db';
import { getFreshSessionUser, isInternal, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { getServiceCalls } from '@/lib/data';
import { audit } from '@/lib/usb';

export async function GET() {
  const user = await getFreshSessionUser();
  if (!isInternal(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  return NextResponse.json(await getServiceCalls());
}

export async function POST(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Installation');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Installation', 'installation.service_call.write');
  if (actionDenied) return actionDenied;

  const b = await req.json();
  if (!String(b.subject || '').trim()) return NextResponse.json({ error: 'Subject is required' }, { status: 400 });

  const callNo = await nextCounterValue('service_call_no');
  const { lastId } = await execute(
    `INSERT INTO service_calls
       (call_no, project_id, customer_name, contact_person, contact_phone, subject, description,
        priority, sla_hours, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [callNo, b.project_id || null, b.customer_name || null, b.contact_person || null, b.contact_phone || null,
      String(b.subject).trim(), b.description || null, b.priority || 'medium', b.sla_hours || null, user.username]
  );
  await audit('service_call_created', { actor: user.username, detail: `SC-${callNo}: ${b.subject}` });
  return NextResponse.json({ id: Number(lastId), call_no: callNo });
}
