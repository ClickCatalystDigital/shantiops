import { NextResponse } from 'next/server';
import { hiddenSalesRecord } from '@/lib/sales-visibility';
import { getQuotationDetail } from '@/lib/data';
import { getFreshSessionUser, canAccessDepartment, isPM, isCustomer } from '@/lib/auth';
import { queryOne } from '@/lib/db';
import { renderQuotationPdf } from '@/lib/quotation-pdf';

export const runtime = 'nodejs';

const CRM_DEPARTMENTS = ['Sales', 'Marketing'];

export async function GET(req, props) {
  const params = await props.params;
  const user = await getFreshSessionUser();
  const hidden = await hiddenSalesRecord(user, 'quotation', params.id); // plan 2a: own records only
  if (hidden) return hidden;
  // A customer may open the offer their own Sale Order was made from (the portal's "Final offer").
  if (isCustomer(user)) {
    const own = await queryOne(
      `SELECT 1 FROM sale_orders so JOIN customers c ON c.id = so.customer_id
        WHERE so.quotation_id = ? AND c.portal_user_id = ? AND so.so_no NOT LIKE 'SAS%'`, [params.id, user.id]);
    if (!own) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  } else if (!isPM(user) && !CRM_DEPARTMENTS.some(d => canAccessDepartment(user, d))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const tpl = new URL(req.url).searchParams.get('template_id');
  const detail = await getQuotationDetail(params.id, tpl ? Number(tpl) : null);
  if (!detail) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const pdf = await renderQuotationPdf(detail, detail.items);
  return new NextResponse(pdf, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${detail.quotation_no.replace(/\//g, '-')}.pdf"`,
    },
  });
}
