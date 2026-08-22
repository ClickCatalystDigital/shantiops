// app/api/executive/management-report/pdf/route.js — PDF export for the Management Report card on
// /executive. Gated by requirePM (admin/manager/executive), same as the page itself — not
// requireDepartment('Accounts'), since this is deliberately an executive-altitude document, not an
// Accounts department report (see REPORT-ENGINE-MATURITY.md §1.2 and the nav finding that led here:
// executives already have backend access to every department's reports, they just don't get a
// per-department Reports tab for it).
import { NextResponse } from 'next/server';
import { getFreshSessionUser, requirePM } from '@/lib/auth';
import { COMPANY_NAMES } from '@/lib/qc-doc-pdf.js';
import { computeManagementReport } from '@/lib/reports/management-report';
import { renderManagementReportPdf } from '@/lib/reports/management-report-pdf';

export const runtime = 'nodejs';

export async function GET(req) {
  const user = await getFreshSessionUser();
  const denied = requirePM(user);
  if (denied) return denied;

  const { searchParams } = new URL(req.url);
  const company = COMPANY_NAMES.includes(searchParams.get('company')) ? searchParams.get('company') : COMPANY_NAMES[0];

  const result = await computeManagementReport(company);
  const stream = await renderManagementReportPdf({ company, result, generatedBy: user.username });

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="management-report-${company.replace(/\s+/g, '-')}.pdf"`,
    },
  });
}
