import { NextResponse } from 'next/server';
import { execute } from '@/lib/db';
import { composeName } from '@/lib/contact-name.mjs';
import { getFreshSessionUser, isInternal, canAccessDepartment, isPM } from '@/lib/auth';
import { requireCrmAction } from '@/lib/action-permissions';
import { getContacts } from '@/lib/data';

const CRM_DEPARTMENTS = ['Sales', 'Marketing'];
function canAccessCrm(user) {
  return isPM(user) || CRM_DEPARTMENTS.some(d => canAccessDepartment(user, d));
}

export async function GET(req) {
  const user = await getFreshSessionUser();
  if (!isInternal(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const customerId = new URL(req.url).searchParams.get('customer_id');
  if (!customerId) return NextResponse.json({ error: 'customer_id is required' }, { status: 400 });
  return NextResponse.json(await getContacts(customerId));
}

export async function POST(req) {
  const user = await getFreshSessionUser();
  if (!canAccessCrm(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const actionDenied = await requireCrmAction(user, 'sales.customer.write');
  if (actionDenied) return actionDenied;
  const b = await req.json();
  if (!b.customer_id) return NextResponse.json({ error: 'customer_id is required' }, { status: 400 });
  const name = composeName(b);
  if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 });
  if (b.is_primary) await execute('UPDATE contacts SET is_primary = 0 WHERE customer_id = ?', [b.customer_id]); // one primary per customer

  const { lastId } = await execute(
    `INSERT INTO contacts (customer_id, name, first_name, last_name, title, designation, department, mobile, phone, email, is_primary, is_authority, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [b.customer_id, name, b.first_name || null, b.last_name || null, b.title || null, b.designation || null, b.department || null,
      b.mobile || null, b.phone || null, b.email || null, b.is_primary ? 1 : 0, b.is_authority ? 1 : 0, b.notes || null]
  );
  return NextResponse.json({ id: Number(lastId) });
}
