// The 33-stage Job Card sheets (lib/job-sheet-stages.mjs). List/create.
import { NextResponse } from 'next/server';
import { queryOne, nextNumber, withTransaction } from '@/lib/db';
import { getFreshSessionUser, requireDepartment, canAccessDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { getJobSheets } from '@/lib/data';
import { JOB_SHEET_STAGES } from '@/lib/job-sheet-stages.mjs';
import { isISODate } from '@/lib/job-sheets';
import { audit } from '@/lib/usb';

export async function GET() {
  const user = await getFreshSessionUser();
  if (!canAccessDepartment(user, 'Production') && !canAccessDepartment(user, 'QC')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return NextResponse.json(await getJobSheets());
}

export async function POST(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Production') || await requireAction(user, 'Production', 'production.jobsheet.write');
  if (denied) return denied;
  const b = await req.json();
  const jobNumber = String(b.job_number || '').trim();
  if (!jobNumber) return NextResponse.json({ error: 'Job number is required' }, { status: 400 });
  if (b.drawing_approved_on && !isISODate(b.drawing_approved_on)) {
    return NextResponse.json({ error: 'Invalid drawing approved date' }, { status: 400 });
  }
  const projectId = b.project_id ? Number(b.project_id) : null;
  if (projectId && !(await queryOne('SELECT 1 FROM projects WHERE id = ?', [projectId]))) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }
  const jcNo = await nextNumber('jc_no', 'JC');
  const id = await withTransaction(async tx => {
    const r = await tx.execute({
      sql: `INSERT INTO job_sheets (jc_no, project_id, job_number, drawing_approved_on, ibr_bvi, drg_nos, boiler_plate_nos, created_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [jcNo, projectId, jobNumber, b.drawing_approved_on || null, String(b.ibr_bvi || '').trim() || null,
        String(b.drg_nos || '').trim() || null, String(b.boiler_plate_nos || '').trim() || null, user.username],
    });
    const sheetId = Number(r.lastInsertRowid);
    for (let i = 0; i < JOB_SHEET_STAGES.length; i++) {
      await tx.execute({
        sql: 'INSERT INTO job_sheet_stages (sheet_id, sort_order, name, group_key) VALUES (?, ?, ?, ?)',
        args: [sheetId, i + 1, JOB_SHEET_STAGES[i].name, JOB_SHEET_STAGES[i].group],
      });
    }
    return sheetId;
  });
  await audit('job_sheet_created', { actor: user.username, detail: `${jcNo} · ${jobNumber}` });
  return NextResponse.json({ id, jc_no: jcNo });
}
