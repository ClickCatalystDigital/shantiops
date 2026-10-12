// app/api/reports/open-po-aging/route.js — Procurement report: issued POs with at least one line
// still TRANSIT, aged by days since issued_at. See lib/data.js's getOpenPoAgingLines.
import { NextResponse } from 'next/server';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { getOpenPoAgingLines } from '@/lib/data';
import { COMPANY_NAMES } from '@/lib/qc-doc-pdf.js';

export async function computeOpenPoAging(company, { asOf } = {}) {
  const lines = await getOpenPoAgingLines(company, { asOf });
  return {
    lines,
    total: lines.length,
    totalOpenValue: lines.reduce((s, l) => s + l.open_value, 0),
    oldestDaysOpen: lines.length ? Math.max(...lines.map((l) => l.daysOpen || 0)) : 0,
  };
}

export async function GET(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Procurement');
  if (denied) return denied;
  const { searchParams } = new URL(req.url);
  const company = COMPANY_NAMES.includes(searchParams.get('company')) ? searchParams.get('company') : COMPANY_NAMES[0];
  const asOf = searchParams.get('as_of') || undefined;
  return NextResponse.json(await computeOpenPoAging(company, { asOf }));
}
