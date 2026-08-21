// app/api/reports/[key]/export/route.js — the one PDF export endpoint for every Report Engine
// report (?format=pdf only for now; Excel deferred, see REPORT-ENGINE-PLAN). Looks the report up in
// lib/reports/catalog.js and computes it via the exact same function its JSON route already
// imports — ground rule: one computed result, three renderers, never three calculations.
import { NextResponse } from 'next/server';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { COMPANY_NAMES } from '@/lib/qc-doc-pdf.js';
import { getReport } from '@/lib/reports/catalog';
import { renderCatalogPdf } from '@/lib/reports/render';

export const runtime = 'nodejs';

// Current Indian financial year (Apr 1 – Mar 31) as ISO bounds — the default date range for a
// row-heavy report's PDF export when no range is given, instead of the screen's "omit both = all
// time" (see catalog.js's `heavy` flag: an unbounded General Ledger roll-up could be hundreds of
// pages as a PDF).
function currentFyBounds() {
  const now = new Date();
  const y = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return { from: `${y}-04-01`, to: `${y + 1}-03-31` };
}

export async function GET(req, { params }) {
  const report = getReport(params.key);
  if (!report) return NextResponse.json({ error: 'Unknown report' }, { status: 404 });

  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, report.department);
  if (denied) return denied;

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

  let result;
  try {
    result = await report.compute(company, { from, to, customerId, supplierId, itemId, asOf, period });
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
  });

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${report.key}.pdf"`,
    },
  });
}
