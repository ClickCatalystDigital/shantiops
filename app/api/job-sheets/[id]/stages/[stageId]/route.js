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

  const denied = requireDepartment(user, 'Production') || await requireAction(user, 'Production', 'production.jobsheet.write');
  if (denied) return denied;

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
    if (row.qc_sign_by && !canAccessDepartment(user, 'QC') && !isPM(user)) return bad('QC has signed this stage — QC must reopen it', 403);
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
    await execute(`UPDATE job_sheet_stages SET ${sets.join(', ')} WHERE id = ?`, [...args, stageId]);
  } else return bad('Unknown action');

  await recomputeSheetDates(sheetId);
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
