import { NextResponse } from 'next/server';
import { execute } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';

const STATUSES = ['open', 'on_hold', 'closed'];

export async function PATCH(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'HR');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'HR', 'hr.recruitment.write');
  if (actionDenied) return actionDenied;
  const b = await req.json();
  if (b.status !== undefined && !STATUSES.includes(b.status)) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
  }
  const fields = [];
  const args = [];
  for (const key of ['title', 'department', 'employment_type_id', 'description', 'status']) {
    if (b[key] !== undefined) { fields.push(`${key} = ?`); args.push(b[key]); }
  }
  if (!fields.length) return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  args.push(params.id);
  await execute(`UPDATE job_openings SET ${fields.join(', ')} WHERE id = ?`, args);
  return NextResponse.json({ ok: true });
}
