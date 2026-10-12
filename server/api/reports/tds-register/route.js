// app/api/reports/tds-register/route.js — REPORT-ENGINE-PLAN.md pattern. What's already been
// deducted, grouped by FY/quarter/section, for whoever files the quarterly 26Q return — this app
// does not generate the TRACES-format return itself, see lib/data.js's getTdsDeductionRegisterLines.
import { NextResponse } from 'next/server';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { getTdsDeductionRegisterLines } from '@/lib/data';
import { COMPANY_NAMES } from '@/lib/qc-doc-pdf.js';

export async function computeTdsRegister(company, { from, to } = {}) {
  const lines = await getTdsDeductionRegisterLines(company, { from, to });
  return {
    lines,
    totalGross: lines.reduce((s, l) => s + (l.total || 0), 0),
    totalTds: lines.reduce((s, l) => s + (l.tds_amount || 0), 0),
  };
}

export async function GET(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Accounts');
  if (denied) return denied;
  const { searchParams } = new URL(req.url);
  const company = COMPANY_NAMES.includes(searchParams.get('company')) ? searchParams.get('company') : COMPANY_NAMES[0];
  const from = searchParams.get('from') || undefined;
  const to = searchParams.get('to') || undefined;
  return NextResponse.json(await computeTdsRegister(company, { from, to }));
}
