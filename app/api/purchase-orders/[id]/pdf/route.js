// app/api/purchase-orders/[id]/pdf/route.js

import { NextResponse } from 'next/server';
import { getPurchaseOrderDetail } from '@/lib/data';
import { getSessionUser, requireDepartment } from '@/lib/auth';
import { renderPoPdf } from '@/lib/po-pdf';

export const runtime = 'nodejs';

export async function GET(req, { params }) {
  const user = getSessionUser();
  const denied = requireDepartment(user, 'Procurement');
  if (denied) return denied;

  const detail = await getPurchaseOrderDetail(params.id);
  if (!detail) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const pdf = await renderPoPdf(detail.po, detail.items);
  return new NextResponse(pdf, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${detail.po.po_no.replace(/\//g, '-')}.pdf"`,
    },
  });
}
