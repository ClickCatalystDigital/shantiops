// app/api/reports/dispatch-register/route.js — Dispatch accounting integration, 2026-08-23.
// Dispatch's first Report Engine entry. Visible to Accounts too, not just Dispatch — mirrors
// app/api/vendor-bills/route.js's cross-department read access — since Accounts needs visibility
// into freight postings across all shipments.
import { NextResponse } from 'next/server';
import { getFreshSessionUser, canAccessDepartment, isPM } from '@/lib/auth';
import { getDispatchRegisterLines } from '@/lib/data';
import { COMPANY_NAMES } from '@/lib/qc-doc-pdf.js';

export async function computeDispatchRegister(company, { from, to } = {}) {
  const shipments = await getDispatchRegisterLines(company, { from, to });
  return {
    shipments,
    totalFreight: shipments.reduce((s, x) => s + (x.freight_amount || 0), 0),
    shipmentCount: shipments.length,
  };
}

export async function GET(req) {
  const user = await getFreshSessionUser();
  if (!isPM(user) && !canAccessDepartment(user, 'Dispatch') && !canAccessDepartment(user, 'Accounts')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const { searchParams } = new URL(req.url);
  const company = COMPANY_NAMES.includes(searchParams.get('company')) ? searchParams.get('company') : COMPANY_NAMES[0];
  const from = searchParams.get('from') || undefined;
  const to = searchParams.get('to') || undefined;
  return NextResponse.json(await computeDispatchRegister(company, { from, to }));
}
