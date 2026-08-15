import { NextResponse } from 'next/server';
import { getSalarySlipDetail } from '@/lib/data';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { renderPayslipPdf } from '@/lib/payslip-pdf';

export const runtime = 'nodejs';

export async function GET(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'HR');
  if (denied) return denied;
  const detail = await getSalarySlipDetail(params.id);
  if (!detail) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const pdf = await renderPayslipPdf(detail, detail.components);
  return new NextResponse(pdf, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${detail.employee_code}-${detail.period_month}-${detail.period_year}.pdf"`,
    },
  });
}
