// app/api/reports/cash-book/route.js — REPORT-ENGINE-PLAN.md §10.
import { NextResponse } from 'next/server';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { getCashBookLines } from '@/lib/data';
import { runningLedger } from '@/lib/ledger.mjs';
import { COMPANY_NAMES } from '@/lib/qc-doc-pdf.js';

export async function computeCashBook(company, { from, to } = {}) {
  const rows = await getCashBookLines(company);
  return runningLedger(rows, { from, to });
}

export async function GET(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Accounts');
  if (denied) return denied;
  const { searchParams } = new URL(req.url);
  const company = COMPANY_NAMES.includes(searchParams.get('company')) ? searchParams.get('company') : COMPANY_NAMES[0];
  const from = searchParams.get('from') || undefined;
  const to = searchParams.get('to') || undefined;
  return NextResponse.json(await computeCashBook(company, { from, to }));
}
