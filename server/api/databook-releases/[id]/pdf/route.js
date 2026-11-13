// A released Data Book: the stored file, never rebuilt.
import { NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import { getFreshSessionUser, canAccessDepartment } from '@/lib/auth';
import { getObjectBuffer } from '@/lib/r2';
import { forbidden, err } from '@/lib/quality-routes';

export async function GET(_req, props) {
  const params = await props.params;
  const user = await getFreshSessionUser();
  if (!canAccessDepartment(user, 'QC')) return forbidden();
  const r = await queryOne('SELECT d.pdf_key, d.revision, p.project_no FROM databook_releases d JOIN projects p ON p.id = d.project_id WHERE d.id = ?', [params.id]);
  if (!r) return err('Not found', 404);
  return new NextResponse(await getObjectBuffer(r.pdf_key), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${r.project_no}-data-book-rev${r.revision}.pdf"` } });
}
