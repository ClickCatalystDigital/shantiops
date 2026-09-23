import { NextResponse } from 'next/server';
import { execute } from '@/lib/db';
import { getFreshSessionUser, canAccessDepartment, isPM } from '@/lib/auth';
import { requireCrmAction } from '@/lib/action-permissions';

const CRM_DEPARTMENTS = ['Sales', 'Marketing'];
function canAccessCrm(user) {
  return isPM(user) || CRM_DEPARTMENTS.some(d => canAccessDepartment(user, d));
}

export async function PATCH(req, { params }) {
  const user = await getFreshSessionUser();
  if (!canAccessCrm(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  // Sibling POST /api/addresses already gates on this key — the edit path (2026-09-23 isolation
  // fix) didn't, so it stayed open to Marketing even after requireCrmAction's own fix.
  const actionDenied = await requireCrmAction(user, 'sales.customer.write');
  if (actionDenied) return actionDenied;
  const b = await req.json();
  const fields = [];
  const args = [];
  for (const key of ['address_type', 'line1', 'line2', 'line3', 'city', 'state', 'state_code', 'country', 'pin_code', 'is_primary', 'active']) {
    if (b[key] !== undefined) { fields.push(`${key} = ?`); args.push(b[key]); }
  }
  if (!fields.length) return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  args.push(params.id);
  await execute(`UPDATE addresses SET ${fields.join(', ')} WHERE id = ?`, args);
  return NextResponse.json({ ok: true });
}
