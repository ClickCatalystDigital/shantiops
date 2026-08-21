// app/api/sales-invoices/[id]/pdf/route.js — REPORT-ENGINE-PLAN.md §7. Same shape/gating as every
// other per-record PDF route (po-pdf, bom-pdf).
import { NextResponse } from 'next/server';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { getSalesInvoiceDetail } from '@/lib/data';
import { renderSalesInvoicePdf } from '@/lib/sales-invoice-pdf';

export const runtime = 'nodejs';

export async function GET(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Sales');
  if (denied) return denied;

  const invoice = await getSalesInvoiceDetail(params.id);
  if (!invoice) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const pdf = await renderSalesInvoicePdf(invoice, invoice.items);
  return new NextResponse(pdf, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${invoice.invoice_no.replace(/\//g, '-')}.pdf"`,
    },
  });
}
