// app/api/sales-invoices/[id]/pdf/route.js — REPORT-ENGINE-PLAN.md §7. Same shape/gating as every
// other per-record PDF route (po-pdf, bom-pdf).
import { NextResponse } from 'next/server';
import { getFreshSessionUser, requireDepartment, isCustomer, canAccessProject } from '@/lib/auth';
import { getSalesInvoiceDetail } from '@/lib/data';
import { renderSalesInvoicePdf } from '@/lib/sales-invoice-pdf';

export const runtime = 'nodejs';

export async function GET(req, { params }) {
  const user = await getFreshSessionUser();
  const invoice = await getSalesInvoiceDetail(params.id);
  if (!invoice) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // A customer may view their own project's issued invoice, read-only, no approval gate needed —
  // same "past draft" rule the packing PDF route already applies (§6).
  if (isCustomer(user)) {
    if (!canAccessProject(user, invoice.project_id) || invoice.status === 'draft') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  } else {
    const denied = requireDepartment(user, 'Sales');
    if (denied) return denied;
  }

  const pdf = await renderSalesInvoicePdf(invoice, invoice.items, user.username);
  return new NextResponse(pdf, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${invoice.invoice_no.replace(/\//g, '-')}.pdf"`,
    },
  });
}
