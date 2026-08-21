// app/api/reports/trial-balance/route.js — ACCOUNTING-IMPLEMENTATION-PLAN.md Phase 5. Derived,
// read-only: no new data, just lib/ledger.mjs's trialBalance() rolled up over lib/data.js's
// getLedgerLines(). ?from&?to default to a period slice; omit both for all-time.
//
// computeTrialBalance is exported so the Report Engine's PDF export
// (app/api/reports/[key]/export/route.js, via lib/reports/catalog.js) computes the exact same
// result object this JSON route returns — ground rule: one computed result, three renderers, never
// three calculations. See REPORT-ENGINE-PLAN.
import { NextResponse } from 'next/server';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { getLedgerLines } from '@/lib/data';
import { trialBalance } from '@/lib/ledger.mjs';
import { COMPANY_NAMES } from '@/lib/qc-doc-pdf.js';

export async function computeTrialBalance(company, { from, to } = {}) {
  const rows = await getLedgerLines(company, { from, to });
  return trialBalance(rows);
}

export async function GET(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Accounts');
  if (denied) return denied;
  const { searchParams } = new URL(req.url);
  const company = COMPANY_NAMES.includes(searchParams.get('company')) ? searchParams.get('company') : COMPANY_NAMES[0];
  const from = searchParams.get('from') || undefined;
  const to = searchParams.get('to') || undefined;
  const result = await computeTrialBalance(company, { from, to });
  return NextResponse.json(result);
}
