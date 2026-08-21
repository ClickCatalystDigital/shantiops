// app/api/reports/sales-register/route.js — REPORT-ENGINE-PLAN.md §10. Gated to Sales — mirror of
// purchase-register/route.js against sales_invoices.
import { NextResponse } from 'next/server';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { getSalesRegisterLines } from '@/lib/data';
import { COMPANY_NAMES } from '@/lib/qc-doc-pdf.js';

export async function computeSalesRegister(company, { from, to } = {}) {
  const invoices = await getSalesRegisterLines(company, { from, to });
  return {
    invoices,
    totalSubtotal: invoices.reduce((s, i) => s + (i.subtotal || 0), 0),
    totalTax: invoices.reduce((s, i) => s + (i.tax_amount || 0), 0),
    totalValue: invoices.reduce((s, i) => s + (i.total || 0), 0),
  };
}

export async function GET(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Sales');
  if (denied) return denied;
  const { searchParams } = new URL(req.url);
  const company = COMPANY_NAMES.includes(searchParams.get('company')) ? searchParams.get('company') : COMPANY_NAMES[0];
  const from = searchParams.get('from') || undefined;
  const to = searchParams.get('to') || undefined;
  return NextResponse.json(await computeSalesRegister(company, { from, to }));
}
