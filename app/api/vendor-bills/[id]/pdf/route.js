// app/api/vendor-bills/[id]/pdf/route.js — REPORT-ENGINE-PLAN.md §7. Mirror of
// sales-invoices/[id]/pdf/route.js.
import { NextResponse } from 'next/server';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { getVendorBillDetail } from '@/lib/data';
import { renderVendorBillPdf } from '@/lib/vendor-bill-pdf';

export const runtime = 'nodejs';

export async function GET(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Procurement');
  if (denied) return denied;

  const bill = await getVendorBillDetail(params.id);
  if (!bill) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const pdf = await renderVendorBillPdf(bill, bill.items, user.username);
  return new NextResponse(pdf, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${bill.bill_no.replace(/\//g, '-')}.pdf"`,
    },
  });
}
