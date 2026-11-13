// Add an extra stage to one sheet (the 33 are copied per sheet, so a sheet may add/remove its own).
import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';

export async function POST(req, props) {
  const params = await props.params;
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Production') || (await requireAction(user, 'Production', 'production.jobsheet.write'));
  if (denied) return denied;
  const id = Number(params.id);
  const b = await req.json();
  const name = String(b.name || '').trim().toUpperCase();
  if (!name) return NextResponse.json({ error: 'Stage name is required' }, { status: 400 });
  const sheet = await queryOne('SELECT itp_template_id FROM job_sheets WHERE id = ?', [id]);
  if (!sheet) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (sheet.itp_template_id) return NextResponse.json({ error: 'ITP points come from the template: change the template for new jobs' }, { status: 409 });
  const { n } = await queryOne('SELECT COALESCE(MAX(sort_order), 0) AS n FROM job_sheet_stages WHERE sheet_id = ?', [id]);
  await execute('INSERT INTO job_sheet_stages (sheet_id, sort_order, name, group_key) VALUES (?, ?, ?, ?)',
    [id, Number(n) + 1, name, b.group_key || null]);
  return NextResponse.json({ ok: true });
}
