import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { composeName } from '@/lib/contact-name.mjs';
import { getFreshSessionUser, canAccessDepartment, isPM } from '@/lib/auth';
import { requireCrmAction } from '@/lib/action-permissions';

const CRM_DEPARTMENTS = ['Sales', 'Marketing'];
function canAccessCrm(user) {
  return isPM(user) || CRM_DEPARTMENTS.some(d => canAccessDepartment(user, d));
}

export async function PATCH(req, { params }) {
  const user = await getFreshSessionUser();
  if (!canAccessCrm(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  // Sibling POST /api/contacts already gates on this key — the edit path (2026-09-23 isolation
  // fix) didn't, so it stayed open to Marketing even after requireCrmAction's own fix.
  const actionDenied = await requireCrmAction(user, 'sales.customer.write');
  if (actionDenied) return actionDenied;
  const b = await req.json();
  const fields = [];
  const args = [];
  const existing = await queryOne('SELECT * FROM contacts WHERE id = ?', [params.id]);
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  for (const key of ['name', 'first_name', 'last_name', 'title', 'designation', 'department', 'mobile', 'phone', 'email', 'is_primary', 'is_authority', 'notes', 'active']) {
    if (b[key] !== undefined) { fields.push(`${key} = ?`); args.push(['is_primary', 'is_authority', 'active'].includes(key) ? (b[key] ? 1 : 0) : (b[key] === '' ? null : b[key])); }
  }
  if (b.first_name !== undefined || b.last_name !== undefined) {
    const name = composeName({ first_name: b.first_name ?? existing.first_name, last_name: b.last_name ?? existing.last_name, name: existing.name });
    if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    fields.push('name = ?'); args.push(name);
  }
  if (!fields.length) return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  if (b.is_primary) await execute('UPDATE contacts SET is_primary = 0 WHERE customer_id = ? AND id <> ?', [existing.customer_id, params.id]); // one primary per customer
  args.push(params.id);
  await execute(`UPDATE contacts SET ${fields.join(', ')} WHERE id = ?`, args);
  return NextResponse.json({ ok: true });
}

// Contacts hang off notes (crm_notes.contact_id) and orders, so removing one only deactivates it.
export async function DELETE(req, { params }) {
  const user = await getFreshSessionUser();
  if (!canAccessCrm(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const actionDenied = await requireCrmAction(user, 'sales.customer.write');
  if (actionDenied) return actionDenied;
  await execute('UPDATE contacts SET active = 0, is_primary = 0 WHERE id = ?', [params.id]);
  return NextResponse.json({ ok: true });
}
