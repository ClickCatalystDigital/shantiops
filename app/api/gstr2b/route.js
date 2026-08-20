// app/api/gstr2b/route.js — ACCOUNTING-IMPLEMENTATION-PLAN.md Phase 5, GST compliance sub-step.
// Manual entry/editing is the exception path (individual corrections, lines that couldn't be
// matched automatically) — the normal intake is app/api/gstr2b/upload's Excel/CSV upload
// (2026-08-20 decision).
import { NextResponse } from 'next/server';
import { execute } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { getGstr2bLines } from '@/lib/data';
import { COMPANY_NAMES } from '@/lib/qc-doc-pdf.js';
import { todayISO } from '@/lib/date';

export async function GET(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Accounts');
  if (denied) return denied;
  const { searchParams } = new URL(req.url);
  const company = COMPANY_NAMES.includes(searchParams.get('company')) ? searchParams.get('company') : COMPANY_NAMES[0];
  const period = searchParams.get('period') || todayISO().slice(0, 7);
  return NextResponse.json(await getGstr2bLines(company, period));
}

export async function POST(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Accounts');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Accounts', 'accounts.gstr2b.write');
  if (actionDenied) return actionDenied;
  const b = await req.json();
  const company = COMPANY_NAMES.includes(b.company) ? b.company : COMPANY_NAMES[0];
  if (!b.period || !b.invoice_no) {
    return NextResponse.json({ error: 'period and invoice_no are required' }, { status: 400 });
  }
  const { lastId } = await execute(
    `INSERT INTO gstr2b_lines
       (company, period, source, supplier_gstin, supplier_name, invoice_no, invoice_date, invoice_value,
        taxable_value, igst, cgst, sgst, cess, itc_availability, itc_reason, created_by)
     VALUES (?, ?, 'manual', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [company, b.period, b.supplier_gstin ?? null, b.supplier_name ?? null, b.invoice_no, b.invoice_date ?? null,
      b.invoice_value ?? 0, b.taxable_value ?? 0, b.igst ?? 0, b.cgst ?? 0, b.sgst ?? 0, b.cess ?? 0,
      b.itc_availability ?? 'Yes', b.itc_reason ?? null, user.username]
  );
  return NextResponse.json({ id: Number(lastId) });
}
