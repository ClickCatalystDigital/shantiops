// app/api/reports/ap-aging/route.js — REPORT-ENGINE-PLAN.md §10. Mirror of ar-aging/route.js.
import { NextResponse } from 'next/server';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { getApAgingLines } from '@/lib/data';
import { agingBuckets } from '@/lib/ledger.mjs';
import { COMPANY_NAMES } from '@/lib/qc-doc-pdf.js';
import { todayISO } from '@/lib/date';

export async function computeApAging(company, { asOf } = {}) {
  const resolvedAsOf = asOf || todayISO();
  const rows = await getApAgingLines(company);
  return { asOf: resolvedAsOf, ...agingBuckets(rows, resolvedAsOf) };
}

export async function GET(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Accounts');
  if (denied) return denied;
  const { searchParams } = new URL(req.url);
  const company = COMPANY_NAMES.includes(searchParams.get('company')) ? searchParams.get('company') : COMPANY_NAMES[0];
  const asOf = searchParams.get('as_of') || undefined;
  return NextResponse.json(await computeApAging(company, { asOf }));
}
