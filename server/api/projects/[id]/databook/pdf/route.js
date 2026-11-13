// The preliminary Data Book, built live from the current records (stamped PRELIMINARY on every page).
import { NextResponse } from 'next/server';
import { getFreshSessionUser, canAccessDepartment } from '@/lib/auth';
import { forbidden, err } from '@/lib/quality-routes';
import { getBook, buildBookPdf } from '@/lib/databook';

export async function GET(_req, props) {
  const params = await props.params;
  const user = await getFreshSessionUser();
  if (!canAccessDepartment(user, 'QC')) return forbidden();
  if (!(await getBook(params.id))) return err('Start the Data Book first', 404);
  const { buf } = await buildBookPdf(Number(params.id), { preliminary: true });
  return new NextResponse(buf, { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename="data-book-preliminary.pdf"' } });
}
