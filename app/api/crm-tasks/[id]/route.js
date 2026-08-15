// app/api/crm-tasks/[id]/route.js — PATCH covers both the status toggle (Tasks panel checkbox)
// and a full field edit, same single-route shape as app/api/opportunities/[id]/route.js. Scoped
// to CRM tasks only (lead_id/opportunity_id/customer_id set) so this never touches a Production
// task sharing the same underlying `tasks` table.
import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, canAccessDepartment } from '@/lib/auth';

const CRM_DEPARTMENTS = ['Sales', 'Marketing'];
const STATUSES = ['open', 'done'];

export async function PATCH(req, { params }) {
  const user = await getFreshSessionUser();
  if (!CRM_DEPARTMENTS.some(d => canAccessDepartment(user, d))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const existing = await queryOne('SELECT * FROM tasks WHERE id = ?', [params.id]);
  if (!existing || (!existing.lead_id && !existing.opportunity_id && !existing.customer_id)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (!canAccessDepartment(user, existing.department)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const b = await req.json();
  const fields = [];
  const args = [];
  if (b.title !== undefined) { fields.push('title = ?'); args.push(String(b.title).trim()); }
  if (b.due_date !== undefined) { fields.push('due_date = ?'); args.push(b.due_date); }
  if (b.assigned_to !== undefined) { fields.push('assigned_to = ?'); args.push(b.assigned_to || null); }
  if (b.status !== undefined) {
    if (!STATUSES.includes(b.status)) return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
    fields.push('status = ?'); args.push(b.status);
  }
  if (!fields.length) return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  args.push(params.id);
  await execute(`UPDATE tasks SET ${fields.join(', ')} WHERE id = ?`, args);
  return NextResponse.json({ ok: true });
}
