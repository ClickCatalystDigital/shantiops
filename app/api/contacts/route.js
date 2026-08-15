import { NextResponse } from 'next/server';
import { execute } from '@/lib/db';
import { getFreshSessionUser, isInternal, canAccessDepartment, isPM } from '@/lib/auth';
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
  const b = await req.json();
  if (!b.customer_id) return NextResponse.json({ error: 'customer_id is required' }, { status: 400 });
  const name = String(b.name || '').trim();
  if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 });

  const { lastId } = await execute(
    `INSERT INTO contacts (customer_id, name, designation, phone, email, is_primary, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [b.customer_id, name, b.designation || null, b.phone || null, b.email || null, b.is_primary ? 1 : 0, b.notes || null]
  );
  return NextResponse.json({ id: Number(lastId) });
}
