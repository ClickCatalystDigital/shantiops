// app/api/sale-orders/[id]/order-pdf/route.js — the PO wizard's own generated confirmation
// document (Phase 2.7). Named `order-pdf`, deliberately distinct from the existing `pdf` route
// (an uploaded/attached source document) and from the real, unrelated Scope of Supply's own
// `sos-pdf` feature.
import { hiddenSalesRecord } from '@/lib/sales-visibility';
import { NextResponse } from 'next/server';
import { getSaleOrderDetail } from '@/lib/data';
import { getFreshSessionUser } from '@/lib/auth';
import { renderSaleOrderPdf } from '@/lib/sale-order-pdf';

export const runtime = 'nodejs';

export async function GET(req, { params }) {
  const user = await getFreshSessionUser();
  const hidden = await hiddenSalesRecord(user, 'sale_order', params.id); // plan 2a: own records only
  if (hidden) return hidden;
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const so = await getSaleOrderDetail(params.id);
  if (!so) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const pdf = await renderSaleOrderPdf(so);
  return new NextResponse(pdf, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${so.so_no.replace(/\//g, '-')}.pdf"`,
    },
  });
}
