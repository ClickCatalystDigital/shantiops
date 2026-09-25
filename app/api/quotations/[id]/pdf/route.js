import { NextResponse } from 'next/server';
import { hiddenSalesRecord } from '@/lib/sales-visibility';
import { getQuotationDetail } from '@/lib/data';
import { getFreshSessionUser, canAccessDepartment, isPM } from '@/lib/auth';
import { renderQuotationPdf } from '@/lib/quotation-pdf';

export const runtime = 'nodejs';

const CRM_DEPARTMENTS = ['Sales', 'Marketing'];

export async function GET(req, { params }) {
  const user = await getFreshSessionUser();
  const hidden = await hiddenSalesRecord(user, 'quotation', params.id); // plan 2a: own records only
  if (hidden) return hidden;
  if (!isPM(user) && !CRM_DEPARTMENTS.some(d => canAccessDepartment(user, d))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const detail = await getQuotationDetail(params.id);
  if (!detail) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const pdf = await renderQuotationPdf(detail, detail.items);
  return new NextResponse(pdf, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${detail.quotation_no.replace(/\//g, '-')}.pdf"`,
    },
  });
}
