// app/api/sales-credit-notes/route.js — list only; creation is via
// app/api/sales-invoices/[id]/credit-note.
import { NextResponse } from 'next/server';
import { getFreshSessionUser, canAccessDepartment, isPM } from '@/lib/auth';
import { getSalesCreditNotes } from '@/lib/data';

const CRM_DEPARTMENTS = ['Sales', 'Marketing'];
function canAccessCrm(user) {
  return isPM(user) || CRM_DEPARTMENTS.some(d => canAccessDepartment(user, d));
}

export async function GET() {
  const user = await getFreshSessionUser();
  if (!canAccessCrm(user) && !canAccessDepartment(user, 'Accounts')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  return NextResponse.json(await getSalesCreditNotes());
}
