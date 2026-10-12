// app/api/executive/customer-profitability/route.js — Management report: margin by customer,
// company-wide. requirePM-gated, see lib/data.js's getCustomerProfitabilityLines.
import { NextResponse } from 'next/server';
import { getFreshSessionUser, requirePM } from '@/lib/auth';
import { getCustomerProfitabilityLines } from '@/lib/data';
import { COMPANY_NAMES } from '@/lib/qc-doc-pdf.js';

export async function computeCustomerProfitability(company, { from, to } = {}) {
  const lines = await getCustomerProfitabilityLines(company, { from, to });
  const totalSellingValue = lines.reduce((s, l) => s + l.sellingValue, 0);
  const totalCost = lines.reduce((s, l) => s + l.totalCost, 0);
  const totalMargin = lines.reduce((s, l) => s + l.margin, 0);
  return {
    lines, totalSellingValue, totalCost, totalMargin,
    overallMarginPct: totalSellingValue ? Math.round((totalMargin / totalSellingValue) * 100) : null,
  };
}

export async function GET(req) {
  const user = await getFreshSessionUser();
  const denied = requirePM(user);
  if (denied) return denied;
  const { searchParams } = new URL(req.url);
  const company = COMPANY_NAMES.includes(searchParams.get('company')) ? searchParams.get('company') : COMPANY_NAMES[0];
  const from = searchParams.get('from') || undefined;
  const to = searchParams.get('to') || undefined;
  return NextResponse.json(await computeCustomerProfitability(company, { from, to }));
}
