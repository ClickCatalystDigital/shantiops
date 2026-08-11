import { NextResponse } from 'next/server';
import { getQuotationDetail } from '@/lib/data';
import { getSessionUser, canAccessDepartment, isPM } from '@/lib/auth';
import { renderQuotationPdf } from '@/lib/quotation-pdf';

export const runtime = 'nodejs';

const CRM_DEPARTMENTS = ['Sales', 'Marketing'];

export async function GET(req, { params }) {
  const user = getSessionUser();
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
