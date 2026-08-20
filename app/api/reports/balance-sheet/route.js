// app/api/reports/balance-sheet/route.js — ACCOUNTING-IMPLEMENTATION-PLAN.md Phase 5. Derived,
// read-only. Cumulative as-of ?as_of (defaults to today) — a balance sheet is a point-in-time
// snapshot, not a period range, so only one date param unlike Trial Balance/P&L.
import { NextResponse } from 'next/server';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { getLedgerLines } from '@/lib/data';
import { balanceSheet } from '@/lib/ledger.mjs';
import { COMPANY_NAMES } from '@/lib/qc-doc-pdf.js';
import { todayISO } from '@/lib/date';

export async function GET(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Accounts');
  if (denied) return denied;
  const { searchParams } = new URL(req.url);
  const company = COMPANY_NAMES.includes(searchParams.get('company')) ? searchParams.get('company') : COMPANY_NAMES[0];
  const asOf = searchParams.get('as_of') || todayISO();
  const rows = await getLedgerLines(company, { to: asOf });
  return NextResponse.json(balanceSheet(rows));
}
