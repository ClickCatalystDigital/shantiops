import { NextResponse } from 'next/server';
import { execute } from '@/lib/db';
import { getSessionUser, canAccessDepartment } from '@/lib/auth';

const CRM_DEPARTMENTS = ['Sales', 'Marketing'];
const STATUSES = ['planned', 'active', 'completed'];

export async function PATCH(req, { params }) {
  const user = getSessionUser();
  if (!CRM_DEPARTMENTS.some(d => canAccessDepartment(user, d))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const b = await req.json();
  if (b.status !== undefined && !STATUSES.includes(b.status)) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
  }
  const fields = [];
  const args = [];
  for (const key of ['name', 'campaign_type', 'start_date', 'end_date', 'status', 'budget', 'notes']) {
    if (b[key] !== undefined) { fields.push(`${key} = ?`); args.push(b[key] || null); }
  }
  if (!fields.length) return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  args.push(params.id);
  await execute(`UPDATE campaigns SET ${fields.join(', ')} WHERE id = ?`, args);
  return NextResponse.json({ ok: true });
}
