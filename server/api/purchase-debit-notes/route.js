// app/api/purchase-debit-notes/route.js — list only; creation is via
// app/api/vendor-bills/[id]/debit-note.
import { NextResponse } from 'next/server';
import { getFreshSessionUser, canAccessDepartment, isPM } from '@/lib/auth';
import { getPurchaseDebitNotes } from '@/lib/data';

export async function GET() {
  const user = await getFreshSessionUser();
  if (!isPM(user) && !canAccessDepartment(user, 'Procurement') && !canAccessDepartment(user, 'Accounts')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return NextResponse.json(await getPurchaseDebitNotes());
}
