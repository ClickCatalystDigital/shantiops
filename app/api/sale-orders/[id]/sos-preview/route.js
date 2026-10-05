// GET /api/sale-orders/[id]/sos-preview — the Scope of Supply PDF a project made from this order will
// start with, rendered live (nothing saved). Used by the New Project overlay. Prices follow the same
// rule as the saved SoS: only Sales / Marketing / PM see them.
import { NextResponse } from 'next/server';
import { getFreshSessionUser, isInternal, isPM, canAccessDepartment } from '@/lib/auth';
import { hiddenSalesRecord } from '@/lib/sales-visibility';
import { getSosPreviewFromSaleOrder } from '@/lib/data';
import { renderSosPdf } from '@/lib/sos-pdf';

export const runtime = 'nodejs';

export async function GET(req, { params }) {
  const user = await getFreshSessionUser();
  const hidden = await hiddenSalesRecord(user, 'sale_order', params.id);
  if (hidden) return hidden;
  if (!isInternal(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const sos = await getSosPreviewFromSaleOrder(Number(params.id));
  if (!sos) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const prices = isPM(user) || canAccessDepartment(user, 'Sales') || canAccessDepartment(user, 'Marketing');
  const pdf = await renderSosPdf(sos, { prices });
  return new NextResponse(pdf, {
    headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${sos.title.replace(/[^a-z0-9]+/gi, '-')}.pdf"` },
  });
}
