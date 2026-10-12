// app/api/reports/ecn-register/route.js — Design management report: every Engineering Change Note
// across projects/period, the audit trail of what changed on a released BOM and why. See
// lib/data.js's getEcnRegisterLines.
import { NextResponse } from 'next/server';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { getEcnRegisterLines } from '@/lib/data';
import { COMPANY_NAMES } from '@/lib/qc-doc-pdf.js';

export async function computeEcnRegister(company, { from, to } = {}) {
  const lines = await getEcnRegisterLines(company, { from, to });
  return {
    lines,
    total: lines.length,
    pending: lines.filter((l) => l.status === 'pending').length,
    approved: lines.filter((l) => l.status === 'approved').length,
    rejected: lines.filter((l) => l.status === 'rejected').length,
  };
}

export async function GET(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Design');
  if (denied) return denied;
  const { searchParams } = new URL(req.url);
  const company = COMPANY_NAMES.includes(searchParams.get('company')) ? searchParams.get('company') : COMPANY_NAMES[0];
  const from = searchParams.get('from') || undefined;
  const to = searchParams.get('to') || undefined;
  return NextResponse.json(await computeEcnRegister(company, { from, to }));
}
