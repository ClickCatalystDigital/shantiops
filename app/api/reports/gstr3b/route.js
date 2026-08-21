// app/api/reports/gstr3b/route.js — ACCOUNTING-IMPLEMENTATION-PLAN.md Phase 5, GST compliance
// sub-step. Derived, read-only: nets this period's GSTR-1 output tax against ITC
// reconciliation's eligible ITC, via lib/gst-return.mjs's gstr3bSummary() — the actual operative
// monthly return (GSTR-3, the full return it was meant to replace, was suspended and never
// revived).
import { NextResponse } from 'next/server';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { getGstr1Lines, getGstr2bLines, getVendorBillsForPeriod } from '@/lib/data';
import { gstr1Summary, itcReconciliation, gstr3bSummary } from '@/lib/gst-return.mjs';
import { COMPANY_NAMES } from '@/lib/qc-doc-pdf.js';
import { todayISO } from '@/lib/date';

// Exported so the Report Engine's PDF export (lib/reports/catalog.js) computes the exact same
// result this JSON route returns — ground rule: one computed result, three renderers.
export async function computeGstr3b(company, { period } = {}) {
  const p = period || todayISO().slice(0, 7);
  const [gstr1Lines, gstr2bLines, vendorBills] = await Promise.all([
    getGstr1Lines(company, p),
    getGstr2bLines(company, p),
    getVendorBillsForPeriod(company, p),
  ]);
  const outward = gstr1Summary(gstr1Lines);
  const itc = itcReconciliation({ gstr2bLines, vendorBills });
  return {
    period: p,
    outwardTax: outward.totalTax,
    eligibleItc: itc.eligibleItc,
    ...gstr3bSummary({ outwardTax: outward.totalTax, eligibleItc: itc.eligibleItc }),
  };
}

export async function GET(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Accounts');
  if (denied) return denied;
  const { searchParams } = new URL(req.url);
  const company = COMPANY_NAMES.includes(searchParams.get('company')) ? searchParams.get('company') : COMPANY_NAMES[0];
  const period = searchParams.get('period') || undefined;
  return NextResponse.json(await computeGstr3b(company, { period }));
}
