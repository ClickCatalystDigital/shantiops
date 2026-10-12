// app/api/executive/manufacturing-performance/route.js — Management report: the director-altitude
// headline for the shop floor (Work Order throughput, rejection rate, material yield, cost
// variance), reusing Production's own report data — see lib/reports/manufacturing-performance.js.
import { NextResponse } from 'next/server';
import { getFreshSessionUser, requirePM } from '@/lib/auth';
import { computeManufacturingPerformance } from '@/lib/reports/manufacturing-performance';
import { COMPANY_NAMES } from '@/lib/qc-doc-pdf.js';

export async function GET(req) {
  const user = await getFreshSessionUser();
  const denied = requirePM(user);
  if (denied) return denied;
  const { searchParams } = new URL(req.url);
  const company = COMPANY_NAMES.includes(searchParams.get('company')) ? searchParams.get('company') : COMPANY_NAMES[0];
  const from = searchParams.get('from') || undefined;
  const to = searchParams.get('to') || undefined;
  return NextResponse.json(await computeManufacturingPerformance(company, { from, to }));
}
