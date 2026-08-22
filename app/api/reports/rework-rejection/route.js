// app/api/reports/rework-rejection/route.js — Production management report: Job Card rejections +
// QC test failures by period, a quality-cost signal nothing else surfaces (REPORT-ENGINE-PLAN.md
// §8). See lib/data.js's getReworkRejectionData for the two-section shape.
import { NextResponse } from 'next/server';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { getReworkRejectionData } from '@/lib/data';
import { COMPANY_NAMES } from '@/lib/qc-doc-pdf.js';

export async function computeReworkRejection(company, { from, to } = {}) {
  return getReworkRejectionData(company, { from, to });
}

export async function GET(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Production');
  if (denied) return denied;
  const { searchParams } = new URL(req.url);
  const company = COMPANY_NAMES.includes(searchParams.get('company')) ? searchParams.get('company') : COMPANY_NAMES[0];
  const from = searchParams.get('from') || undefined;
  const to = searchParams.get('to') || undefined;
  return NextResponse.json(await computeReworkRejection(company, { from, to }));
}
