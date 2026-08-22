// app/api/executive/procurement-spend/route.js — Management report: spend by supplier,
// company-wide. requirePM-gated, see lib/data.js's getProcurementSpendLines.
import { NextResponse } from 'next/server';
import { getFreshSessionUser, requirePM } from '@/lib/auth';
import { getProcurementSpendLines } from '@/lib/data';
import { COMPANY_NAMES } from '@/lib/qc-doc-pdf.js';

export async function computeProcurementSpend(company, { from, to } = {}) {
  const lines = await getProcurementSpendLines(company, { from, to });
  return {
    lines,
    totalSubtotal: lines.reduce((s, l) => s + l.subtotal, 0),
    totalTax: lines.reduce((s, l) => s + l.taxAmount, 0),
    totalPayable: lines.reduce((s, l) => s + l.payable, 0),
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
  return NextResponse.json(await computeProcurementSpend(company, { from, to }));
}
