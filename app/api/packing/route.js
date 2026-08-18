import { NextResponse } from 'next/server';
import { execute, nextNumber, queryAll } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { audit } from '@/lib/usb';

export async function POST(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Dispatch');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Dispatch', 'dispatch.packing.create');
  if (actionDenied) return actionDenied;
  const b = await req.json();
  if (!b.customer_name?.trim()) {
    return NextResponse.json({ error: 'Customer name is required' }, { status: 400 });
  }
  const packing_no = await nextNumber('packing_no', 'PL');
  const r = await execute(
    `INSERT INTO packing_lists
       (project_id, packing_no, customer_name, customer_address, invoice_no, dc_no, dc_date,
        vehicle_no, dispatch_through, contact_person, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [b.project_id || null, packing_no, b.customer_name.trim(), b.customer_address || null,
     b.invoice_no || null, b.dc_no || null, b.dc_date || null, b.vehicle_no || null,
     b.dispatch_through || null, b.contact_person || null, user?.username || null]
  );
  await audit('packing_created', { actor: user.username, detail: `${packing_no} · project ${b.project_id || '—'} (manual)` });
  return NextResponse.json({ id: Number(r.lastId), packing_no });
}

// Used by the packing-list "new" form to preselect a project.
export async function GET() {
  const denied = requireDepartment(await getFreshSessionUser(), 'Dispatch');
  if (denied) return denied;
  const projects = await queryAll('SELECT id, project_no, customer_name FROM projects ORDER BY created_at DESC');
  return NextResponse.json({ projects });
}
