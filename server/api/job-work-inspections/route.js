// STERP item 33 (§5p) — Job-Work Inspection: material sent to an outside job worker, expected
// return, received qty, quality result. Mirrors app/api/qc-records/route.js exactly — QC + PM,
// project-scoped, no GET (fetched server-side via lib/data.js like qc_records itself).
import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { audit } from '@/lib/usb';

export async function POST(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'QC');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'QC', 'qc.jobwork.write');
  if (actionDenied) return actionDenied;

  const b = await req.json();
  if (!b.project_id || !b.job_worker_name?.trim()) {
    return NextResponse.json({ error: 'project_id and job_worker_name are required' }, { status: 400 });
  }
  const project = await queryOne('SELECT id FROM projects WHERE id = ?', [b.project_id]);
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

  const result = ['pass', 'fail', 'pending'].includes(b.result) ? b.result : 'pending';
  const res = await execute(
    `INSERT INTO job_work_inspections (project_id, bom_item_id, job_worker_name, job_worker_contact,
       sent_date, expected_return_date, sent_qty, received_qty, received_date, result, notes, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [b.project_id, b.bom_item_id ? Number(b.bom_item_id) : null, b.job_worker_name.trim(),
      b.job_worker_contact?.trim() || null, b.sent_date || null, b.expected_return_date || null,
      b.sent_qty != null && b.sent_qty !== '' ? Number(b.sent_qty) : null,
      b.received_qty != null && b.received_qty !== '' ? Number(b.received_qty) : null,
      b.received_date || null, result, b.notes?.trim() || null, user.username]);

  await audit('job_work_inspection_add', {
    actor: user.username,
    detail: JSON.stringify({ job_work_inspection_id: Number(res.lastId), project_id: b.project_id }),
  });
  return NextResponse.json({ id: Number(res.lastId) });
}
