// app/api/reports/qc-inspection-summary/route.js — QC report (plan §4). See lib/data.js's
// getQcInspectionSummary.
import { NextResponse } from 'next/server';
import { getFreshSessionUser, canAccessDepartment, isPM } from '@/lib/auth';
import { getQcInspectionSummary } from '@/lib/data';
import { COMPANY_NAMES } from '@/lib/qc-doc-pdf.js';

export async function computeQcInspectionSummary(company, { from, to } = {}) {
  const lines = await getQcInspectionSummary(company, { from, to });
  const totalPass = lines.reduce((s, l) => s + l.pass_count, 0);
  const totalFail = lines.reduce((s, l) => s + l.fail_count, 0);
  const totalPending = lines.reduce((s, l) => s + l.pending_count, 0);
  return { lines, totalPass, totalFail, totalPending };
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
  return NextResponse.json(await computeQcInspectionSummary(company, { from, to }));
}
