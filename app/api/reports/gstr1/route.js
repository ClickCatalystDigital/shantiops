// app/api/reports/gstr1/route.js — ACCOUNTING-IMPLEMENTATION-PLAN.md Phase 5, GST compliance
// sub-step. Derived, read-only: no new data, lib/gst-return.mjs's gstr1Summary() rolled up over
// lib/data.js's getGstr1Lines(). Also the IFF generator — same report, a QRMP filer just runs it
// for a quarter's first two months instead of GSTR-1 (see company_settings.gst_return_frequency).
import { NextResponse } from 'next/server';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { getGstr1Lines } from '@/lib/data';
import { gstr1Summary } from '@/lib/gst-return.mjs';
import { COMPANY_NAMES } from '@/lib/qc-doc-pdf.js';
import { todayISO } from '@/lib/date';

export async function GET(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Accounts');
  if (denied) return denied;
  const { searchParams } = new URL(req.url);
  const company = COMPANY_NAMES.includes(searchParams.get('company')) ? searchParams.get('company') : COMPANY_NAMES[0];
  const period = searchParams.get('period') || todayISO().slice(0, 7);
  const rows = await getGstr1Lines(company, period);
  return NextResponse.json({ period, ...gstr1Summary(rows) });
}
