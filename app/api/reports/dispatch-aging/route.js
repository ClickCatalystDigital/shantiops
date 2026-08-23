// app/api/reports/dispatch-aging/route.js — Dispatch report (plan §4), the non-dispatched
// population the Dispatch Register excludes. See lib/data.js's getDispatchAgingLines. No from/to —
// this is a point-in-time snapshot of what's currently pending, not a period report.
import { NextResponse } from 'next/server';
import { getFreshSessionUser, canAccessDepartment, isPM } from '@/lib/auth';
import { getDispatchAgingLines } from '@/lib/data';
import { COMPANY_NAMES } from '@/lib/qc-doc-pdf.js';

export async function computeDispatchAging(company) {
  const lines = await getDispatchAgingLines(company);
  return { lines, total: lines.length };
}

export async function GET(req) {
  const user = await getFreshSessionUser();
  if (!isPM(user) && !canAccessDepartment(user, 'Dispatch')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const { searchParams } = new URL(req.url);
  const company = COMPANY_NAMES.includes(searchParams.get('company')) ? searchParams.get('company') : COMPANY_NAMES[0];
  return NextResponse.json(await computeDispatchAging(company));
}
