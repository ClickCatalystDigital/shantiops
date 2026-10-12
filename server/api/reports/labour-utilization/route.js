// app/api/reports/labour-utilization/route.js — Production management report: hours + cost per
// employee over a period, off job_card_time_logs. See lib/data.js's getLabourUtilizationLines.
import { NextResponse } from 'next/server';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { getLabourUtilizationLines } from '@/lib/data';
import { COMPANY_NAMES } from '@/lib/qc-doc-pdf.js';

export async function computeLabourUtilization(company, { from, to } = {}) {
  const lines = await getLabourUtilizationLines(company, { from, to });
  return {
    lines,
    totalHours: Math.round((lines.reduce((s, l) => s + (l.total_minutes || 0), 0) / 60) * 10) / 10,
    totalCost: lines.reduce((s, l) => s + (l.labor_cost || 0), 0),
  };
}

export async function GET(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Production');
  if (denied) return denied;
  const { searchParams } = new URL(req.url);
  const company = COMPANY_NAMES.includes(searchParams.get('company')) ? searchParams.get('company') : COMPANY_NAMES[0];
  const from = searchParams.get('from') || undefined;
  const to = searchParams.get('to') || undefined;
  return NextResponse.json(await computeLabourUtilization(company, { from, to }));
}
