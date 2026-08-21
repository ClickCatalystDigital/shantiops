// app/api/reports/journal-register/route.js — REPORT-ENGINE-PLAN.md §10. Flat period listing (no
// running-balance concept, unlike the ledger reports) — from/to filter directly in SQL is correct
// here.
import { NextResponse } from 'next/server';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { getJournalRegisterLines } from '@/lib/data';
import { COMPANY_NAMES } from '@/lib/qc-doc-pdf.js';

export async function computeJournalRegister(company, { from, to } = {}) {
  const entries = await getJournalRegisterLines(company, { from, to });
  return { entries, total: entries.reduce((s, e) => s + (e.amount || 0), 0) };
}

export async function GET(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Accounts');
  if (denied) return denied;
  const { searchParams } = new URL(req.url);
  const company = COMPANY_NAMES.includes(searchParams.get('company')) ? searchParams.get('company') : COMPANY_NAMES[0];
  const from = searchParams.get('from') || undefined;
  const to = searchParams.get('to') || undefined;
  return NextResponse.json(await computeJournalRegister(company, { from, to }));
}
