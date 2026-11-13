// Data Book templates (a customer's table of contents). Loaded by the seed; read here to start a project's book.
import { NextResponse } from 'next/server';
import { queryAll } from '@/lib/db';
import { getFreshSessionUser, canAccessDepartment } from '@/lib/auth';
import { forbidden } from '@/lib/quality-routes';
import { parseJson } from '@/lib/quality';

export async function GET() {
  const user = await getFreshSessionUser();
  if (!canAccessDepartment(user, 'QC')) return forbidden();
  const rows = await queryAll('SELECT * FROM databook_templates ORDER BY is_default DESC, name');
  return NextResponse.json(rows.map(r => ({ ...r, lines: parseJson(r.lines_json, []), lines_json: undefined })));
}
