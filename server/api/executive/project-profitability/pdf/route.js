// app/api/executive/project-profitability/pdf/route.js — PDF export, reusing renderCatalogPdf
// directly (the generic table+totals renderer) rather than the department-catalog machinery in
// lib/reports/catalog.js — these Management reports are requirePM-gated, not department-gated, so
// they don't belong in that catalog (same reasoning as the Management Report itself).
import { NextResponse } from 'next/server';
import { getFreshSessionUser, requirePM } from '@/lib/auth';
import { COMPANY_NAMES } from '@/lib/qc-doc-pdf.js';
import { currentFyBounds } from '@/lib/date';
import { renderCatalogPdf } from '@/lib/reports/render';
import { projectProfitabilityTable } from '@/lib/reports/render.js';
import { computeProjectProfitability } from '../route.js';
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

  const result = await computeProjectProfitability(company, { from, to });
  const table = projectProfitabilityTable(result);
  const totals = [
    ['Total Selling Value', fmt(result.totalSellingValue)],
    ['Total Cost', fmt(result.totalCost)],
    ['Total Margin', fmt(result.totalMargin)],
    ['Overall Margin %', result.overallMarginPct == null ? '—' : `${result.overallMarginPct}%`],
  ];

  const stream = await renderCatalogPdf({
    company, title: 'PROJECT PROFITABILITY', subtitle: `${from} to ${to}`, table, totals,
    generatedBy: user.username, orientation: 'landscape',
  });

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'inline; filename="project-profitability.pdf"',
    },
  });
}
