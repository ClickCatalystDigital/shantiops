// app/api/reports/job-work-inspection-register/route.js — QC report. See lib/data.js's
// getJobWorkInspectionRegisterLines. Same skeleton as ncr-register/route.js.
import { NextResponse } from 'next/server';
import { getFreshSessionUser, canAccessDepartment, isPM } from '@/lib/auth';
import { getJobWorkInspectionRegisterLines } from '@/lib/data';
import { COMPANY_NAMES } from '@/lib/qc-doc-pdf.js';

export async function computeJobWorkInspectionRegister(company, { from, to } = {}) {
  const lines = await getJobWorkInspectionRegisterLines(company, { from, to });
  return {
    lines,
    total: lines.length,
    totalSent: lines.reduce((s, l) => s + (l.sent_qty || 0), 0),
    totalReceived: lines.reduce((s, l) => s + (l.received_qty || 0), 0),
    totalVariance: lines.reduce((s, l) => s + (l.variance_qty || 0), 0),
  };
}

export async function GET(req) {
  const user = await getFreshSessionUser();
  if (!isPM(user) && !canAccessDepartment(user, 'QC')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const { searchParams } = new URL(req.url);
  const company = COMPANY_NAMES.includes(searchParams.get('company')) ? searchParams.get('company') : COMPANY_NAMES[0];
  const from = searchParams.get('from') || undefined;
  const to = searchParams.get('to') || undefined;
  return NextResponse.json(await computeJobWorkInspectionRegister(company, { from, to }));
}
