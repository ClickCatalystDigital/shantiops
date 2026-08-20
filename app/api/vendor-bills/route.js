// app/api/vendor-bills/route.js — list only; creation is via
// app/api/purchase-orders/[id]/record-bill.
import { NextResponse } from 'next/server';
import { getFreshSessionUser, canAccessDepartment, isPM } from '@/lib/auth';
import { getVendorBills } from '@/lib/data';

export async function GET() {
  const user = await getFreshSessionUser();
  if (!isPM(user) && !canAccessDepartment(user, 'Procurement') && !canAccessDepartment(user, 'Accounts')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return NextResponse.json(await getVendorBills());
}
