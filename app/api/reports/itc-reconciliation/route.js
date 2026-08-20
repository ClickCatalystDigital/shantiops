// app/api/reports/itc-reconciliation/route.js — ACCOUNTING-IMPLEMENTATION-PLAN.md Phase 5, GST
// compliance sub-step. Derived, read-only: matches this period's uploaded/manual GSTR-2B lines
// (app/api/gstr2b) against this period's own Vendor Bills via lib/gst-return.mjs's
// itcReconciliation(). Shanti Ops' Vendor Bill ledger stays the accounting source of truth —
// GSTR-2B/IMS is the external input being reconciled against, not the other way round.
import { NextResponse } from 'next/server';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { getGstr2bLines, getVendorBillsForPeriod } from '@/lib/data';
import { itcReconciliation } from '@/lib/gst-return.mjs';
import { COMPANY_NAMES } from '@/lib/qc-doc-pdf.js';
import { todayISO } from '@/lib/date';

export async function GET(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Accounts');
  if (denied) return denied;
  const { searchParams } = new URL(req.url);
  const company = COMPANY_NAMES.includes(searchParams.get('company')) ? searchParams.get('company') : COMPANY_NAMES[0];
  const period = searchParams.get('period') || todayISO().slice(0, 7);
  const [gstr2bLines, vendorBills] = await Promise.all([
    getGstr2bLines(company, period),
    getVendorBillsForPeriod(company, period),
  ]);
  return NextResponse.json({ period, ...itcReconciliation({ gstr2bLines, vendorBills }) });
}
