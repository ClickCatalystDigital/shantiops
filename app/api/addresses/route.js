import { NextResponse } from 'next/server';
import { execute } from '@/lib/db';
import { getSessionUser, isInternal, canAccessDepartment, isPM } from '@/lib/auth';
import { getAddresses } from '@/lib/data';

const CRM_DEPARTMENTS = ['Sales', 'Marketing'];
function canAccessCrm(user) {
  return isPM(user) || CRM_DEPARTMENTS.some(d => canAccessDepartment(user, d));
}

export async function GET(req) {
  const user = getSessionUser();
  if (!isInternal(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const customerId = new URL(req.url).searchParams.get('customer_id');
  if (!customerId) return NextResponse.json({ error: 'customer_id is required' }, { status: 400 });
  return NextResponse.json(await getAddresses(customerId));
}

export async function POST(req) {
  const user = getSessionUser();
  if (!canAccessCrm(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const b = await req.json();
  if (!b.customer_id) return NextResponse.json({ error: 'customer_id is required' }, { status: 400 });

  const { lastId } = await execute(
    `INSERT INTO addresses (customer_id, address_type, line1, line2, line3, city, state, state_code, country, pin_code, is_primary)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [b.customer_id, b.address_type || 'Billing', b.line1 || null, b.line2 || null, b.line3 || null,
      b.city || null, b.state || null, b.state_code || null, b.country || 'India', b.pin_code || null, b.is_primary ? 1 : 0]
  );
  return NextResponse.json({ id: Number(lastId) });
}
