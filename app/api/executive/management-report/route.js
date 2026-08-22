// app/api/executive/management-report/route.js — JSON data for the /executive Management Report
// card (components/executive/ManagementReportCard.jsx). Same compute() as the PDF export route
// (app/api/executive/management-report/pdf/route.js) — one computed result, two renderers.
import { NextResponse } from 'next/server';
import { getFreshSessionUser, requirePM } from '@/lib/auth';
import { COMPANY_NAMES } from '@/lib/qc-doc-pdf.js';
import { computeManagementReport } from '@/lib/reports/management-report';

export async function GET(req) {
  const user = await getFreshSessionUser();
  const denied = requirePM(user);
  if (denied) return denied;

  const { searchParams } = new URL(req.url);
  const company = COMPANY_NAMES.includes(searchParams.get('company')) ? searchParams.get('company') : COMPANY_NAMES[0];

  const result = await computeManagementReport(company);
  return NextResponse.json(result);
}
