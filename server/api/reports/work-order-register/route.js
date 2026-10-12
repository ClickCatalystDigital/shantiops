// app/api/reports/work-order-register/route.js — Production management report: "what's in
// production and is it on time." See lib/data.js's getWorkOrderRegisterLines for the query/derived
// fields (delayed flag mirrors getWorkOrderDetail()'s own definition, §5l).
import { NextResponse } from 'next/server';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { getWorkOrderRegisterLines } from '@/lib/data';
import { COMPANY_NAMES } from '@/lib/qc-doc-pdf.js';

export async function computeWorkOrderRegister(company, { from, to } = {}) {
  const lines = await getWorkOrderRegisterLines(company, { from, to });
  return {
    lines,
    total: lines.length,
    delayed: lines.filter((l) => l.delayed).length,
    completed: lines.filter((l) => l.status === 'completed').length,
    inProgress: lines.filter((l) => l.status === 'in_progress').length,
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
  return NextResponse.json(await computeWorkOrderRegister(company, { from, to }));
}
