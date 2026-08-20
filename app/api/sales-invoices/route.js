// app/api/sales-invoices/route.js — list only; creation is exclusively via
// app/api/quotations/[id]/convert-to-invoice (ACCOUNTING-IMPLEMENTATION-PLAN.md Phase 2 — "Convert
// to Invoice from an accepted Quotation, not a from-scratch form as the only path in").
import { NextResponse } from 'next/server';
import { getFreshSessionUser, canAccessDepartment, isPM } from '@/lib/auth';
import { getSalesInvoices } from '@/lib/data';

const CRM_DEPARTMENTS = ['Sales', 'Marketing'];
function canAccessCrm(user) {
  return isPM(user) || CRM_DEPARTMENTS.some(d => canAccessDepartment(user, d));
}

export async function GET() {
  const user = await getFreshSessionUser();
  if (!canAccessCrm(user) && !canAccessDepartment(user, 'Accounts')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  return NextResponse.json(await getSalesInvoices());
}
