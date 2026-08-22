// app/api/executive/manufacturing-performance/pdf/route.js — PDF export.
import { NextResponse } from 'next/server';
import { getFreshSessionUser, requirePM } from '@/lib/auth';
import { COMPANY_NAMES } from '@/lib/qc-doc-pdf.js';
import { currentFyBounds } from '@/lib/date';
import { computeManufacturingPerformance } from '@/lib/reports/manufacturing-performance';
import { renderManufacturingPerformancePdf } from '@/lib/reports/manufacturing-performance-pdf';

export const runtime = 'nodejs';

export async function GET(req) {
  const user = await getFreshSessionUser();
  const denied = requirePM(user);
  if (denied) return denied;

  const { searchParams } = new URL(req.url);
  const company = COMPANY_NAMES.includes(searchParams.get('company')) ? searchParams.get('company') : COMPANY_NAMES[0];
  let from = searchParams.get('from') || undefined;
  let to = searchParams.get('to') || undefined;
  if (!from && !to) ({ from, to } = currentFyBounds());

  const result = await computeManufacturingPerformance(company, { from, to });
  const stream = await renderManufacturingPerformancePdf({
    company, result, subtitle: `${from} to ${to}`, generatedBy: user.username,
  });

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'inline; filename="manufacturing-performance.pdf"',
    },
  });
}
