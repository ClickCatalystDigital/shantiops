// app/api/reports/depreciation-schedule/route.js — ACCOUNTING-IMPLEMENTATION-PLAN.md Phase 9. One
// row per asset per period run, tying back to depreciation_run_lines (§5z) — wiring it into the
// Report Engine catalog like every other report. No new calculation: the amount was already
// computed by lib/depreciation.mjs's monthlyDepreciation() at run time.
import { NextResponse } from 'next/server';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { getDepreciationScheduleLines } from '@/lib/data';
import { COMPANY_NAMES } from '@/lib/qc-doc-pdf.js';

export async function computeDepreciationSchedule(company, { from, to } = {}) {
  const lines = await getDepreciationScheduleLines(company, { from, to });
  return { lines, totalAmount: lines.reduce((s, l) => s + (l.amount || 0), 0) };
}

export async function GET(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Accounts');
  if (denied) return denied;
  const { searchParams } = new URL(req.url);
  const company = COMPANY_NAMES.includes(searchParams.get('company')) ? searchParams.get('company') : COMPANY_NAMES[0];
  const from = searchParams.get('from') || undefined;
  const to = searchParams.get('to') || undefined;
  return NextResponse.json(await computeDepreciationSchedule(company, { from, to }));
}
