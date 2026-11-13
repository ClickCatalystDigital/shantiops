import { NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import { getFreshSessionUser, canAccessDepartment } from '@/lib/auth';
import { getObjectBuffer } from '@/lib/r2';
import { forbidden, err } from '@/lib/quality-routes';

export async function GET(_req, props) {
  const params = await props.params;
  const user = await getFreshSessionUser();
  if (!canAccessDepartment(user, 'QC')) return forbidden();
  const f = await queryOne('SELECT pdf_key FROM databook_files WHERE id = ? AND project_id = ?', [params.fileId, params.id]);
  if (!f) return err('Not found', 404);
  return new NextResponse(await getObjectBuffer(f.pdf_key), { headers: { 'Content-Type': 'application/pdf' } });
}
