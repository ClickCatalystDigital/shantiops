// app/api/reports/profit-loss/route.js — ACCOUNTING-IMPLEMENTATION-PLAN.md Phase 5. Derived,
// read-only. ?from&?to scope the period; both should normally be passed (a P&L without a period
// isn't meaningful) but default to all-time if omitted, same as Trial Balance.
import { NextResponse } from 'next/server';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { getLedgerLines } from '@/lib/data';
import { profitAndLoss } from '@/lib/ledger.mjs';
import { COMPANY_NAMES } from '@/lib/qc-doc-pdf.js';

export async function GET(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Accounts');
  if (denied) return denied;
  const { searchParams } = new URL(req.url);
  const company = COMPANY_NAMES.includes(searchParams.get('company')) ? searchParams.get('company') : COMPANY_NAMES[0];
  const from = searchParams.get('from') || undefined;
  const to = searchParams.get('to') || undefined;
  const rows = await getLedgerLines(company, { from, to });
  return NextResponse.json(profitAndLoss(rows));
}
