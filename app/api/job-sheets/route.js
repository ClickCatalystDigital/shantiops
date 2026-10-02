// The 33-stage Job Card sheets (lib/job-sheet-stages.mjs). List/create.
import { NextResponse } from 'next/server';
import { queryOne, nextNumber, withTransaction } from '@/lib/db';
import { getFreshSessionUser, requireDepartment, canAccessDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { getJobSheets } from '@/lib/data';
import { JOB_SHEET_TYPES } from '@/lib/job-sheet-stages.mjs';
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
  const cardType = b.card_type || 'boiler';
  if (!JOB_SHEET_TYPES[cardType]) return NextResponse.json({ error: 'Unknown job card type' }, { status: 400 });
  const stages = JOB_SHEET_TYPES[cardType].stages;
  const projectId = b.project_id ? Number(b.project_id) : null;
  if (projectId && !(await queryOne('SELECT 1 FROM projects WHERE id = ?', [projectId]))) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }
  const jcNo = await nextNumber('jc_no', 'JC');
  const id = await withTransaction(async tx => {
    const r = await tx.execute({
      sql: `INSERT INTO job_sheets (jc_no, project_id, job_number, drawing_approved_on, ibr_bvi, drg_nos, boiler_plate_nos, created_by, card_type, owner_name)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [jcNo, projectId, jobNumber, b.drawing_approved_on || null, String(b.ibr_bvi || '').trim() || null,
        String(b.drg_nos || '').trim() || null, String(b.boiler_plate_nos || '').trim() || null, user.username, cardType, String(b.owner_name || '').trim() || null],
    });
    const sheetId = Number(r.lastInsertRowid);
    for (let i = 0; i < stages.length; i++) {
      await tx.execute({
        sql: 'INSERT INTO job_sheet_stages (sheet_id, sort_order, name, group_key) VALUES (?, ?, ?, ?)',
        args: [sheetId, i + 1, stages[i].name, stages[i].group],
      });
    }
    return sheetId;
  });
  await audit('job_sheet_created', { actor: user.username, detail: `${jcNo} · ${cardType} · ${jobNumber}` });
  return NextResponse.json({ id, jc_no: jcNo, stages: stages.length });
}
