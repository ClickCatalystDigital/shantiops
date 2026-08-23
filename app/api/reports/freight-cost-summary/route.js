// app/api/reports/freight-cost-summary/route.js — Dispatch report (plan §4). See lib/data.js's
// getFreightCostSummary.
import { NextResponse } from 'next/server';
import { getFreshSessionUser, canAccessDepartment, isPM } from '@/lib/auth';
import { getFreightCostSummary } from '@/lib/data';
import { COMPANY_NAMES } from '@/lib/qc-doc-pdf.js';

export async function computeFreightCostSummary(company, { from, to } = {}) {
  const lines = await getFreightCostSummary(company, { from, to });
  const totalFreight = lines.reduce((s, l) => s + (l.freight_amount || 0), 0);
  const byUs = lines.filter(l => l.freight_paid_by === 'us').reduce((s, l) => s + (l.freight_amount || 0), 0);
  const byCustomer = lines.filter(l => l.freight_paid_by === 'customer').reduce((s, l) => s + (l.freight_amount || 0), 0);
  return { lines, totalFreight, byUs, byCustomer };
}

export async function GET(req) {
  const user = await getFreshSessionUser();
  if (!isPM(user) && !canAccessDepartment(user, 'Dispatch')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const { searchParams } = new URL(req.url);
  const company = COMPANY_NAMES.includes(searchParams.get('company')) ? searchParams.get('company') : COMPANY_NAMES[0];
  const from = searchParams.get('from') || undefined;
  const to = searchParams.get('to') || undefined;
  return NextResponse.json(await computeFreightCostSummary(company, { from, to }));
}
