// app/api/gst-filings/route.js — ACCOUNTING-IMPLEMENTATION-PLAN.md Phase 5, GST compliance
// sub-step. Record-keeping only ("we filed GSTR-1 for Shanti Boilers, 2026-07, on the portal") —
// no enforcement, no period lock (Phase 5's own non-goal). Lets GSTR-1A be understood as "the
// current GSTR-1 report, re-run and amended on the portal after this date" without Shanti Ops
// having to model a separate amendment document.
import { NextResponse } from 'next/server';
import { execute } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { getGstFilings } from '@/lib/data';
import { COMPANY_NAMES } from '@/lib/qc-doc-pdf.js';

const RETURN_TYPES = ['GSTR1', 'IFF', 'GSTR3B'];

export async function GET(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Accounts');
  if (denied) return denied;
  const { searchParams } = new URL(req.url);
  const company = COMPANY_NAMES.includes(searchParams.get('company')) ? searchParams.get('company') : COMPANY_NAMES[0];
  return NextResponse.json(await getGstFilings(company));
}

export async function POST(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Accounts');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Accounts', 'accounts.gst_filing.write');
  if (actionDenied) return actionDenied;
  const b = await req.json();
  const company = COMPANY_NAMES.includes(b.company) ? b.company : COMPANY_NAMES[0];
  if (!b.period || !RETURN_TYPES.includes(b.return_type)) {
    return NextResponse.json({ error: 'period and a valid return_type are required' }, { status: 400 });
  }
  const { lastId } = await execute(
    `INSERT INTO gst_filings (company, period, return_type, created_by) VALUES (?, ?, ?, ?)
     ON CONFLICT(company, period, return_type) DO UPDATE SET filed_at = CURRENT_TIMESTAMP, created_by = excluded.created_by`,
    [company, b.period, b.return_type, user.username]
  );
  return NextResponse.json({ id: Number(lastId) });
}
