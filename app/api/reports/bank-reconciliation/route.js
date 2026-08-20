// app/api/reports/bank-reconciliation/route.js — ACCOUNTING-IMPLEMENTATION-PLAN.md Phase 5
// completion. The minimum reconciliation workflow: every posted journal_entry_line against the
// Bank & Cash control account (1001), for Accounts to manually tick off against the real bank
// statement. Deliberately not a bank_accounts master or statement importer — that's Phase 7's
// Cheque Printing scope, untouched.
import { NextResponse } from 'next/server';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { getBankLedgerLines } from '@/lib/data';
import { COMPANY_NAMES } from '@/lib/qc-doc-pdf.js';

export async function GET(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Accounts');
  if (denied) return denied;
  const { searchParams } = new URL(req.url);
  const company = COMPANY_NAMES.includes(searchParams.get('company')) ? searchParams.get('company') : COMPANY_NAMES[0];
  const from = searchParams.get('from') || undefined;
  const to = searchParams.get('to') || undefined;
  const lines = await getBankLedgerLines(company, { from, to });
  const reconciledBalance = lines.filter(l => l.reconciled).reduce((s, l) => s + (l.debit || 0) - (l.credit || 0), 0);
  const unreconciledBalance = lines.filter(l => !l.reconciled).reduce((s, l) => s + (l.debit || 0) - (l.credit || 0), 0);
  return NextResponse.json({
    lines,
    reconciledBalance: Math.round(reconciledBalance * 100) / 100,
    unreconciledBalance: Math.round(unreconciledBalance * 100) / 100,
  });
}
