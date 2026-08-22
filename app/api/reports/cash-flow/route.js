// app/api/reports/cash-flow/route.js — ACCOUNTING-IMPLEMENTATION-PLAN.md Phase 9. Indirect-method
// Cash Flow Statement (method + categorization confirmed with user before building — see
// lib/cash-flow.mjs's own header comment). Wires lib/cash-flow.mjs's indirectCashFlow() into the
// Report Engine catalog like every other report.
import { NextResponse } from 'next/server';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { getLedgerLines, getFixedAssetCashLines, getChartOfAccounts } from '@/lib/data';
import { indirectCashFlow } from '@/lib/cash-flow.mjs';
import { COMPANY_NAMES } from '@/lib/qc-doc-pdf.js';

export async function computeCashFlow(company, { from, to } = {}) {
  const [periodRows, investingCashLines, accounts] = await Promise.all([
    getLedgerLines(company, { from, to }),
    getFixedAssetCashLines(company, { from, to }),
    getChartOfAccounts(company),
  ]);
  const categoryOverrides = Object.fromEntries(
    accounts.filter(a => a.cash_flow_category).map(a => [a.code, a.cash_flow_category])
  );
  return indirectCashFlow(periodRows, investingCashLines, { categoryOverrides });
}

export async function GET(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Accounts');
  if (denied) return denied;
  const { searchParams } = new URL(req.url);
  const company = COMPANY_NAMES.includes(searchParams.get('company')) ? searchParams.get('company') : COMPANY_NAMES[0];
  const from = searchParams.get('from') || undefined;
  const to = searchParams.get('to') || undefined;
  return NextResponse.json(await computeCashFlow(company, { from, to }));
}
