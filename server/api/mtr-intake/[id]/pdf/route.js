import { NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import { getFreshSessionUser, canAccessDepartment } from '@/lib/auth';
import { getObjectBuffer } from '@/lib/r2';
import { forbidden, err } from '@/lib/quality-routes';

export async function GET(_req, props) {
  const params = await props.params;
  const user = await getFreshSessionUser();
  if (!canAccessDepartment(user, 'QC')) return forbidden();
  const m = await queryOne('SELECT pdf_key FROM mtr_intake WHERE id = ?', [params.id]);
  if (!m?.pdf_key) return err('No file', 404);
  return new NextResponse(await getObjectBuffer(m.pdf_key), { headers: { 'Content-Type': 'application/pdf' } });
}
