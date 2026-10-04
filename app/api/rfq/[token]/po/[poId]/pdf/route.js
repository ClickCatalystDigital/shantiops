// The supplier's copy of their purchase order, on their private link. Only an issued PO of this supplier
// that came out of this RFQ.
import { NextResponse } from 'next/server';
import { getRfqByToken, getPurchaseOrderDetail } from '@/lib/data';
import { renderPoPdf } from '@/lib/po-pdf';

export const runtime = 'nodejs';

export async function GET(_req, { params }) {
  const rs = await getRfqByToken(params.token);
  if (!rs) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (rs.token_expires && rs.token_expires < Date.now()) return NextResponse.json({ error: 'This link has expired' }, { status: 410 });
  if (!rs.orders.some(o => o.id === Number(params.poId))) return NextResponse.json({ error: 'That order is not available on this link' }, { status: 404 });
  const detail = await getPurchaseOrderDetail(params.poId);
  if (!detail || detail.po.status !== 'issued') return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const pdf = await renderPoPdf(detail.po, detail.items);
  return new NextResponse(pdf, { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${detail.po.po_no.replace(/\//g, '-')}.pdf"` } });
}
