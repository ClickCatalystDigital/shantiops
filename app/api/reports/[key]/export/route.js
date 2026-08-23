// app/api/reports/[key]/export/route.js — the one PDF export endpoint for every Report Engine
// report (?format=pdf only for now; Excel deferred, see REPORT-ENGINE-PLAN). Looks the report up in
// lib/reports/catalog.js and computes it via the exact same function its JSON route already
// imports — ground rule: one computed result, three renderers, never three calculations.
import { NextResponse } from 'next/server';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { COMPANY_NAMES } from '@/lib/qc-doc-pdf.js';
import { getReport } from '@/lib/reports/catalog';
import { renderCatalogPdf } from '@/lib/reports/render';
import { currentFyBounds } from '@/lib/date';

export const runtime = 'nodejs';

export async function GET(req, { params }) {
  const report = getReport(params.key);
  if (!report) return NextResponse.json({ error: 'Unknown report' }, { status: 404 });

  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, report.department);
  if (denied) return denied;
  // hasOwnControls reports (CRM analytics, Management reports) render their own screen with no
  // compute()/toTable() pair — the UI never renders a PDF button for them (ReportsWorkspace.jsx),
  // but guard the route directly too rather than letting `report.compute(...)` throw on an
  // undefined function if it's ever hit by URL. After the auth check, not before — no reason to
  // tell an unauthorized/unauthenticated caller anything about a report's shape.
  if (report.hasOwnControls) return NextResponse.json({ error: 'This report has no PDF export' }, { status: 400 });

  const { searchParams } = new URL(req.url);
  const format = searchParams.get('format') || 'pdf';
  if (format !== 'pdf') return NextResponse.json({ error: 'Only format=pdf is supported' }, { status: 400 });

  const company = COMPANY_NAMES.includes(searchParams.get('company')) ? searchParams.get('company') : COMPANY_NAMES[0];
  let from = searchParams.get('from') || undefined;
  let to = searchParams.get('to') || undefined;
  if (report.heavy && !from && !to) ({ from, to } = currentFyBounds());
  // Not every report's compute() takes the same params (§10: param shapes genuinely differ, no
  // generic schema) — these are every extra param any registered report needs today, forwarded
  // harmlessly to every report's compute(), which just ignores whichever ones it doesn't use.
  const customerId = searchParams.get('customer_id') || undefined;
  const supplierId = searchParams.get('supplier_id') || undefined;
  const itemId = searchParams.get('item_id') || undefined;
  const asOf = searchParams.get('as_of') || undefined;
  const period = searchParams.get('period') || undefined;
  const horizonDays = searchParams.get('horizon_days') || undefined;

  let result;
  try {
    result = await report.compute(company, { from, to, customerId, supplierId, itemId, asOf, period, horizonDays });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
  const table = report.toTable(result);
  const totals = report.totals ? report.totals(result) : [];
  const subtitle = report.subtitle
    ? report.subtitle(result, { from, to, asOf, period })
    : (from && to ? `${from} to ${to}` : undefined);

  const stream = await renderCatalogPdf({
    company, title: report.title.toUpperCase(), subtitle, table, totals,
    generatedBy: user.username, orientation: report.orientation,
  });

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${report.key}.pdf"`,
    },
  });
}
