// app/api/service-calls/[id]/visits/route.js — STERP item 36's visit history: one row per site
// visit against a service call, independent of the call's own status transitions.
import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { audit } from '@/lib/usb';

export async function POST(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Installation');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Installation', 'installation.service_call.write');
  if (actionDenied) return actionDenied;

  const call = await queryOne('SELECT * FROM service_calls WHERE id = ?', [params.id]);
  if (!call) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const b = await req.json();
  const { lastId } = await execute(
    `INSERT INTO service_call_visits (service_call_id, visit_date, technician, notes, created_by)
     VALUES (?, ?, ?, ?, ?)`,
    [params.id, b.visit_date || new Date().toISOString(), b.technician || null, b.notes || null, user.username]
  );
  await audit('service_call_visit_logged', { actor: user.username, detail: `SC-${call.call_no}: visit by ${b.technician || 'unknown'}` });
  return NextResponse.json({ id: Number(lastId) });
}
