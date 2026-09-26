import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, requireDepartment, canAccessDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { getJobSheetDetail } from '@/lib/data';
import { isISODate } from '@/lib/job-sheets';
import { audit } from '@/lib/usb';

export async function GET(_req, { params }) {
  const user = await getFreshSessionUser();
  if (!canAccessDepartment(user, 'Production') && !canAccessDepartment(user, 'QC')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const d = await getJobSheetDetail(Number(params.id));
  return d ? NextResponse.json(d) : NextResponse.json({ error: 'Not found' }, { status: 404 });
}

const TEXT = ['job_number', 'ibr_bvi', 'drg_nos', 'boiler_plate_nos', 'notes'];

// Header edits + the two sheet-level signatures (Production I/C, QC).
export async function PATCH(req, { params }) {
  const user = await getFreshSessionUser();
  const id = Number(params.id);
  const b = await req.json();
  if (!(await queryOne('SELECT 1 FROM job_sheets WHERE id = ?', [id]))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (b.sign === 'qc') {
    const denied = requireDepartment(user, 'QC') || await requireAction(user, 'QC', 'qc.jobsheet.sign');
    if (denied) return denied;
    await execute('UPDATE job_sheets SET qc_sign_by = ?, qc_sign_at = CURRENT_TIMESTAMP WHERE id = ?', [user.username, id]);
    await audit('job_sheet_qc_signed', { actor: user.username, detail: `sheet ${id}` });
    return NextResponse.json({ ok: true });
  }
  const denied = requireDepartment(user, 'Production') || await requireAction(user, 'Production', 'production.jobsheet.write');
  if (denied) return denied;
  if (b.sign === 'production') {
    await execute('UPDATE job_sheets SET production_sign_by = ?, production_sign_at = CURRENT_TIMESTAMP WHERE id = ?', [user.username, id]);
    await audit('job_sheet_production_signed', { actor: user.username, detail: `sheet ${id}` });
    return NextResponse.json({ ok: true });
  }
  const sets = [], args = [];
  for (const k of TEXT) if (k in b) { sets.push(`${k} = ?`); args.push(String(b[k] ?? '').trim() || null); }
  if ('drawing_approved_on' in b) {
    if (b.drawing_approved_on && !isISODate(b.drawing_approved_on)) return NextResponse.json({ error: 'Invalid date' }, { status: 400 });
    sets.push('drawing_approved_on = ?'); args.push(b.drawing_approved_on || null);
  }
  if ('project_id' in b) { sets.push('project_id = ?'); args.push(b.project_id ? Number(b.project_id) : null); }
  if (!sets.length) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
  await execute(`UPDATE job_sheets SET ${sets.join(', ')} WHERE id = ?`, [...args, id]);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Production') || await requireAction(user, 'Production', 'production.jobsheet.write');
  if (denied) return denied;
  const id = Number(params.id);
  const sheet = await queryOne('SELECT jc_no FROM job_sheets WHERE id = ?', [id]);
  if (!sheet) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  await execute('DELETE FROM job_sheet_stages WHERE sheet_id = ?', [id]);
  await execute('DELETE FROM job_sheets WHERE id = ?', [id]);
  await audit('job_sheet_deleted', { actor: user.username, detail: sheet.jc_no });
  return NextResponse.json({ ok: true });
}
