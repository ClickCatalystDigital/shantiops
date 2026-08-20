import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { audit } from '@/lib/usb';

const EDITABLE = [
  'job_worker_name', 'job_worker_contact', 'sent_date', 'expected_return_date',
  'sent_qty', 'received_qty', 'received_date', 'result', 'notes',
];

// Edits a job-work inspection — most commonly filling in received_qty/received_date/result once
// the material comes back. Variance (sent_qty - received_qty) is computed live at read time
// (lib/data.js), never stored.
export async function PATCH(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'QC');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'QC', 'qc.jobwork.write');
  if (actionDenied) return actionDenied;

  const record = await queryOne('SELECT * FROM job_work_inspections WHERE id = ?', [params.id]);
  if (!record) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const b = await req.json();
  const keys = Object.keys(b).filter(k => EDITABLE.includes(k));
  if (!keys.length) return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  if (keys.includes('job_worker_name') && !String(b.job_worker_name || '').trim()) {
    return NextResponse.json({ error: 'Job worker name cannot be empty' }, { status: 400 });
  }
  if (keys.includes('result') && !['pass', 'fail', 'pending'].includes(b.result)) {
    return NextResponse.json({ error: 'Invalid result' }, { status: 400 });
  }

  const changed = {};
  for (const k of keys) {
    let v = typeof b[k] === 'string' ? b[k].trim() : b[k];
    if (v === '') v = null;
    changed[k] = v;
  }
  await execute(
    `UPDATE job_work_inspections SET ${Object.keys(changed).map(k => `${k} = ?`).join(', ')} WHERE id = ?`,
    [...Object.values(changed), params.id]);

  await audit('job_work_inspection_edit', {
    actor: user.username,
    detail: JSON.stringify({ job_work_inspection_id: Number(params.id), project_id: record.project_id, changed }),
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'QC');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'QC', 'qc.jobwork.delete');
  if (actionDenied) return actionDenied;

  const record = await queryOne('SELECT * FROM job_work_inspections WHERE id = ?', [params.id]);
  if (!record) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  await execute('DELETE FROM job_work_inspections WHERE id = ?', [params.id]);
  await audit('job_work_inspection_delete', {
    actor: user.username,
    detail: JSON.stringify({ job_work_inspection_id: Number(params.id), project_id: record.project_id }),
  });
  return NextResponse.json({ ok: true });
}
