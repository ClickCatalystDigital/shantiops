// app/api/leads/[id]/route.js — V3_CHANGES.md §12. Plain field-level PATCH, same shape as
// app/api/opportunities/[id]/route.js.
import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, canAccessDepartment } from '@/lib/auth';
import { audit } from '@/lib/usb';

const CRM_DEPARTMENTS = ['Sales', 'Marketing'];

export async function PATCH(req, { params }) {
  const user = await getFreshSessionUser();
  if (!CRM_DEPARTMENTS.some(d => canAccessDepartment(user, d))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const existing = await queryOne('SELECT * FROM leads WHERE id = ?', [params.id]);
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!canAccessDepartment(user, existing.owner_dept)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const b = await req.json();
  const fields = [];
  const args = [];
  const STATUSES = ['new', 'contacted', 'qualified', 'converted', 'lost'];
  for (const [key, col] of [
    ['lead_name', 'lead_name'], ['company_name', 'company_name'], ['phone', 'phone'],
    ['email', 'email'], ['source', 'source'], ['notes', 'notes'], ['campaign_id', 'campaign_id'],
    ['territory', 'territory'], ['industry', 'industry'], ['next_contact_date', 'next_contact_date'],
    ['assigned_to', 'assigned_to'],
  ]) {
    if (b[key] !== undefined) { fields.push(`${col} = ?`); args.push(b[key] || null); }
  }
  if (b.status !== undefined) {
    if (!STATUSES.includes(b.status)) return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
    fields.push('status = ?'); args.push(b.status);
  }
  if (!fields.length) return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  fields.push('updated_at = CURRENT_TIMESTAMP');
  args.push(params.id);
  await execute(`UPDATE leads SET ${fields.join(', ')} WHERE id = ?`, args);
  await audit('lead_updated', { actor: user.username, detail: `#${params.id}` });
  return NextResponse.json({ ok: true });
}
