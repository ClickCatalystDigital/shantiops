// app/api/executive/procurement-spend/pdf/route.js — PDF export, reusing renderCatalogPdf directly
// (see project-profitability/pdf/route.js for why this bypasses lib/reports/catalog.js).
import { NextResponse } from 'next/server';
import { getFreshSessionUser, requirePM } from '@/lib/auth';
import { COMPANY_NAMES } from '@/lib/qc-doc-pdf.js';
import { currentFyBounds } from '@/lib/date';
import { renderCatalogPdf } from '@/lib/reports/render';
import { procurementSpendTable } from '@/lib/reports/render.js';
import { computeProcurementSpend } from '../route.js';
import { fmt } from '@/lib/report-pdf.js';

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

  const result = await computeProcurementSpend(company, { from, to });
  const table = procurementSpendTable(result);
  const totals = [
    ['Total Subtotal', fmt(result.totalSubtotal)],
    ['Total Tax', fmt(result.totalTax)],
    ['Total Payable', fmt(result.totalPayable)],
  ];

  const stream = await renderCatalogPdf({
    company, title: 'PROCUREMENT SPEND', subtitle: `${from} to ${to}`, table, totals,
    generatedBy: user.username,
  });

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'inline; filename="procurement-spend.pdf"',
    },
  });
}
