// app/api/reports/sales-register/route.js — REPORT-ENGINE-PLAN.md §10. Gated to Sales — mirror of
// purchase-register/route.js against sales_invoices.
import { NextResponse } from 'next/server';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { getSalesRegisterLines } from '@/lib/data';
import { scopeRows } from '@/lib/sales-visibility';
import { getSelectedCompanyFor } from '@/lib/company-filter-server';

// `user` (optional) scopes the register to a Sales member's own invoices (plan 2a); the JSON route
// and the PDF/Excel export both pass it.
export async function computeSalesRegister(company, { from, to, user } = {}) {
  let invoices = await getSalesRegisterLines(company, { from, to });
  if (user) invoices = await scopeRows(user, 'invoices', invoices);
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
  // Follows the company picked in the top bar (null = All companies); the report has no company buttons of its own.
  const company = getSelectedCompanyFor(user);
  const from = searchParams.get('from') || undefined;
  const to = searchParams.get('to') || undefined;
  return NextResponse.json(await computeSalesRegister(company, { from, to, user }));
}
