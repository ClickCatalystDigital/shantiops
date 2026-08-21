// app/api/reports/purchase-register/route.js — REPORT-ENGINE-PLAN.md §10. Gated to Procurement
// (not Accounts) — matches §7's placement and who actually owns "every purchase this period".
import { NextResponse } from 'next/server';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { getPurchaseRegisterLines } from '@/lib/data';
import { COMPANY_NAMES } from '@/lib/qc-doc-pdf.js';

export async function computePurchaseRegister(company, { from, to } = {}) {
  const bills = await getPurchaseRegisterLines(company, { from, to });
  return {
    bills,
    totalSubtotal: bills.reduce((s, b) => s + (b.subtotal || 0), 0),
    totalTax: bills.reduce((s, b) => s + (b.tax_amount || 0), 0),
    totalPayable: bills.reduce((s, b) => s + (b.payable_amount || 0), 0),
  };
}

export async function GET(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Procurement');
  if (denied) return denied;
  const { searchParams } = new URL(req.url);
  const company = COMPANY_NAMES.includes(searchParams.get('company')) ? searchParams.get('company') : COMPANY_NAMES[0];
  const from = searchParams.get('from') || undefined;
  const to = searchParams.get('to') || undefined;
  return NextResponse.json(await computePurchaseRegister(company, { from, to }));
}
