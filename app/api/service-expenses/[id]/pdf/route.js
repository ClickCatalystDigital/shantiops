// Printable Service expense form — same visibility as the JSON detail route.
import { NextResponse } from 'next/server';
import { getFreshSessionUser } from '@/lib/auth';
import { getRequest, canView } from '@/lib/service-expenses';
import { renderServiceExpensePdf } from '@/lib/service-expense-pdf';

export const runtime = 'nodejs';

export async function GET(_req, { params }) {
  const user = await getFreshSessionUser();
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const r = await getRequest(Number(params.id));
  if (!r) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!canView(user, r)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const pdf = await renderServiceExpensePdf(r);
  return new NextResponse(pdf, { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${r.req_no}.pdf"` } });
}
