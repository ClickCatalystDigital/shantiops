// One stage row. Actions stamp the acting user + time server-side (never client-supplied):
//   start   -> start date (+ fitter/welder)          Production
//   finish  -> end date + production sign            Production
//   qc      -> inspection date, certificate, QC sign QC   (a record only — nothing is blocked by it)
//   reopen  -> clear the row's dates/signs           Production (a QC-signed row: QC or PM only)
//   edit    -> fitter, dates, remarks (backdating)   Production
import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, requireDepartment, canAccessDepartment, isPM } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { todayISO } from '@/lib/date';
import { isISODate, recomputeSheetDates } from '@/lib/job-sheets';
import { audit } from '@/lib/usb';
import { notifyDepartment } from '@/lib/notify';

const bad = (m, status = 400) => NextResponse.json({ error: m }, { status });

export async function PATCH(req, { params }) {
  const user = await getFreshSessionUser();
  const sheetId = Number(params.id), stageId = Number(params.stageId);
  const row = await queryOne('SELECT * FROM job_sheet_stages WHERE id = ? AND sheet_id = ?', [stageId, sheetId]);
  if (!row) return bad('Stage not found', 404);
  const b = await req.json();
  const date = b.date || todayISO();
  if (!isISODate(date)) return bad('Invalid date');

  if (b.action === 'qc') {
    const denied = requireDepartment(user, 'QC') || await requireAction(user, 'QC', 'qc.jobsheet.sign');
    if (denied) return denied;
    if (!row.end_date) return bad('Production has not finished this stage yet');
    const insp = b.inspection_date || date;
    if (!isISODate(insp)) return bad('Invalid inspection date');
    const cert = b.test_certificate_id ? Number(b.test_certificate_id) : null;
    if (cert && !(await queryOne('SELECT 1 FROM test_certificates WHERE id = ?', [cert]))) return bad('Test certificate not found', 404);
    await execute(
      `UPDATE job_sheet_stages SET inspection_date = ?, test_certificate_id = ?, qc_sign_by = ?, qc_sign_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [insp, cert, user.username, stageId]);
    await audit('job_sheet_stage_qc', { actor: user.username, detail: `sheet ${sheetId} · ${row.name}` });
    return NextResponse.json({ ok: true });
  }

  // QC may reopen a stage it signed; everything else here is Production's.
  const qcReopen = b.action === 'reopen' && canAccessDepartment(user, 'QC');
  if (b.action === 'send_back') {
    const d0 = requireDepartment(user, 'QC') || await requireAction(user, 'QC', 'qc.jobsheet.sign');
    if (d0) return d0;
    const reason = String(b.reason || '').trim();
    if (!reason) return bad('Give a reason for sending it back');
    if (!row.end_date || row.qc_sign_by) return bad('Only a finished, unsigned stage can be sent back');
    await execute(`UPDATE job_sheet_stages SET end_date = NULL, production_sign_by = NULL, production_sign_at = NULL,
      remarks = ? WHERE id = ?`, [`QC sent back: ${reason}`, stageId]);
    await recomputeSheetDates(sheetId);
    await audit('job_sheet_stage_sent_back', { actor: user.username, detail: `sheet ${sheetId} · ${row.name} · ${reason}` });
    try {
      await notifyDepartment('Production', { kind: 'jobsheet_sent_back', title: `QC sent back "${row.name}": ${reason}`, dedupe_key: `jobsheet_back:${stageId}:${Date.now()}` });
    } catch { /* best-effort */ }
    return NextResponse.json({ ok: true });
  }
  const denied = qcReopen ? null : (requireDepartment(user, 'Production') || await requireAction(user, 'Production', 'production.jobsheet.write'));
  if (denied) return denied;
  const locked = row.qc_sign_by && !canAccessDepartment(user, 'QC') && !isPM(user);
  if (locked && b.action !== 'reopen') return bad('QC has signed this stage — QC must reopen it first', 403);

  if (b.action === 'start') {
    const fitter = b.fitter_employee_id ? Number(b.fitter_employee_id) : row.fitter_employee_id;
    if (!fitter) return bad('Pick the fitter/welder first');
    await execute('UPDATE job_sheet_stages SET fitter_employee_id = ?, start_date = ? WHERE id = ?', [fitter, date, stageId]);
  } else if (b.action === 'finish') {
    if (!row.start_date && !row.fitter_employee_id && !b.fitter_employee_id) return bad('Start the stage (and pick the fitter/welder) first');
    await execute(
      `UPDATE job_sheet_stages SET start_date = COALESCE(start_date, ?), end_date = ?, fitter_employee_id = COALESCE(?, fitter_employee_id),
              production_sign_by = ?, production_sign_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [date, date, b.fitter_employee_id ? Number(b.fitter_employee_id) : null, user.username, stageId]);
  } else if (b.action === 'reopen') {
    if (locked) return bad('QC has signed this stage — QC must reopen it', 403);
    await execute(
      `UPDATE job_sheet_stages SET end_date = NULL, production_sign_by = NULL, production_sign_at = NULL,
              inspection_date = NULL, test_certificate_id = NULL, qc_sign_by = NULL, qc_sign_at = NULL WHERE id = ?`, [stageId]);
  } else if (b.action === 'edit') {
    const sets = [], args = [];
    if ('fitter_employee_id' in b) { sets.push('fitter_employee_id = ?'); args.push(b.fitter_employee_id ? Number(b.fitter_employee_id) : null); }
    for (const k of ['start_date', 'end_date']) if (k in b) {
      if (b[k] && !isISODate(b[k])) return bad(`Invalid ${k}`);
      sets.push(`${k} = ?`); args.push(b[k] || null);
    }
    if ('remarks' in b) { sets.push('remarks = ?'); args.push(String(b.remarks || '').trim() || null); }
    if (!sets.length) return bad('Nothing to update');
    // Clearing the end date un-finishes the stage, so its production sign goes too.
    if ('end_date' in b && !b.end_date) sets.push('production_sign_by = NULL', 'production_sign_at = NULL');
    await execute(`UPDATE job_sheet_stages SET ${sets.join(', ')} WHERE id = ?`, [...args, stageId]);
  } else return bad('Unknown action');

  await recomputeSheetDates(sheetId);
  if (b.action === 'finish') {
    // One QC alert per job per day (not one per stage).
    try {
      const js = await queryOne('SELECT jc_no, job_number, project_id FROM job_sheets WHERE id = ?', [sheetId]);
      await notifyDepartment('QC', { kind: 'jobsheet_qc', title: `Job card ${js.job_number || js.jc_no}: stage(s) finished, waiting for QC sign`,
        project_id: js.project_id, dedupe_key: `jobsheet_qc:${sheetId}:${todayISO()}` });
    } catch { /* best-effort */ }
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Production') || await requireAction(user, 'Production', 'production.jobsheet.write');
  if (denied) return denied;
  const sheetId = Number(params.id), stageId = Number(params.stageId);
  const row = await queryOne('SELECT qc_sign_by FROM job_sheet_stages WHERE id = ? AND sheet_id = ?', [stageId, sheetId]);
  if (!row) return bad('Stage not found', 404);
  if (row.qc_sign_by) return bad('QC has signed this stage — it cannot be removed', 409);
  await execute('DELETE FROM job_sheet_stages WHERE id = ?', [stageId]);
  await recomputeSheetDates(sheetId);
  return NextResponse.json({ ok: true });
}
