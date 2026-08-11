import { NextResponse } from 'next/server';
import { execute } from '@/lib/db';
import { getSessionUser, isInternal, canAccessDepartment, isPM } from '@/lib/auth';
import { getCustomerDetail } from '@/lib/data';
import { audit } from '@/lib/usb';

const CRM_DEPARTMENTS = ['Sales', 'Marketing'];
function canAccessCrm(user) {
  return isPM(user) || CRM_DEPARTMENTS.some(d => canAccessDepartment(user, d));
}

export async function GET(req, { params }) {
  const user = getSessionUser();
  if (!isInternal(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const detail = await getCustomerDetail(params.id);
  if (!detail) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(detail);
}

export async function PATCH(req, { params }) {
  const user = getSessionUser();
  if (!canAccessCrm(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const b = await req.json();
  const fields = [];
  const args = [];
  for (const key of ['name', 'gst_no', 'phone', 'email', 'address', 'city', 'state', 'state_code', 'pin_code', 'active']) {
    if (b[key] !== undefined) { fields.push(`${key} = ?`); args.push(b[key]); }
  }
  if (!fields.length) return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  args.push(params.id);
  await execute(`UPDATE customers SET ${fields.join(', ')} WHERE id = ?`, args);
  await audit(b.active === 0 ? 'customer_deactivated' : 'customer_updated', { actor: user.username, detail: `#${params.id}` });
  return NextResponse.json({ ok: true });
}
