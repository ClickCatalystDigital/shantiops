// One stage row. Actions stamp the acting user + time server-side (never client-supplied):
//   start   -> start date (+ fitter/welder)          Production
//   finish  -> end date + production sign            Production
//   qc      -> inspection date, certificate, QC sign QC
//   notify / release / na  (ITP cards only)            QC: witness notice, customer release on a hold point, not applicable
// On an ITP card (job_sheets.itp_template_id) lib/quality-gate.mjs is checked here: a blocked point refuses
// start/finish/date edits with 409, and QC sign needs the point's passing tests and no open NCR. Boiler and
// APH cards have no template and behave exactly as before (QC sign is a record only).
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
import { syncProductionFromJobSheets, maybeStartProductionForProject } from '@/lib/milestone-auto';
import { isDispatchStage } from '@/lib/job-sheet-stages.mjs';
import { tabLink } from '@/lib/alert-links.mjs';
import { loadSheetGate, stateOf } from '@/lib/quality';
import { blockedMessage, testState, openNcrs, pointType } from '@/lib/quality-gate.mjs';

const bad = (m, status = 400) => NextResponse.json({ error: m }, { status });

export async function PATCH(req, props) {
  const params = await props.params;
  const user = await getFreshSessionUser();
  const sheetId = Number(params.id), stageId = Number(params.stageId);
  const row = await queryOne('SELECT * FROM job_sheet_stages WHERE id = ? AND sheet_id = ?', [stageId, sheetId]);
  if (!row) return bad('Stage not found', 404);
  const b = await req.json();
  const date = b.date || todayISO();
  if (!isISODate(date)) return bad('Invalid date');
  const gate = await loadSheetGate(sheetId);
  const g = gate && stateOf(gate, stageId);
  const refuse = m => bad(m, 409);

  if (gate && ['notify', 'release', 'na'].includes(b.action)) {
    const releasing = b.action === 'release';
    const denied = requireDepartment(user, 'QC') || (await requireAction(user, 'QC', releasing ? 'qc.itp.release' : 'qc.jobsheet.sign'));
    if (denied) return denied;
    if (b.action === 'notify') {
      if (pointType(row.point_type) !== 'W') return bad('Only a witness point takes a notice');
      const r = await execute('UPDATE job_sheet_stages SET notified_at = CURRENT_TIMESTAMP, notified_by = ? WHERE id = ? AND notified_at IS NULL', [user.username, stageId]);
      if (!r.changes) return refuse('Notice is already recorded');
    } else if (releasing) {
      if (pointType(row.point_type) !== 'H') return bad('Only a hold point takes a customer release');
      const ref = String(b.release_ref || '').trim();
      if (!ref) return bad('Say how the customer authorized it (email, signed ITP, inspector on site)');
      // One conditional write: two parallel releases can never both succeed.
      const r = await execute(`UPDATE job_sheet_stages SET released_at = CURRENT_TIMESTAMP, released_by = ?, release_ref = ?
        WHERE id = ? AND released_at IS NULL AND qc_sign_by IS NOT NULL`, [user.username, ref, stageId]);
      if (!r.changes) return refuse(row.released_at ? 'Already released' : 'QC must sign this point before the customer release is recorded');
    } else {
      const reason = String(b.reason || '').trim();
      if (!reason) return bad('Give the reason this point does not apply');
      if (row.qc_sign_by) return refuse('This point is signed — reopen it first');
      await execute('UPDATE job_sheet_stages SET not_applicable = 1, na_reason = ? WHERE id = ?', [reason, stageId]);
    }
    await audit(`itp_point_${b.action}`, { actor: user.username, detail: `${gate.sheet.jc_no} · ${row.item_key} ${row.name}${b.release_ref ? ` · ${b.release_ref}` : ''}${b.reason ? ` · ${b.reason}` : ''}` });
    return NextResponse.json({ ok: true });
  }

  if (b.action === 'qc') {
    const denied = requireDepartment(user, 'QC') || (await requireAction(user, 'QC', 'qc.jobsheet.sign'));
    if (denied) return denied;
    if (gate) {
      if (row.not_applicable) return refuse('This point is marked not applicable');
      if (row.qc_sign_by) return refuse('Already QC-signed');
      if (g.blocked) return refuse(`Blocked by ${blockedMessage(g)}`);
      const t = testState(row, gate.records, gate.welds);
      if (!t.ok) return refuse(`Needs a passing ${row.test_type || 'inspection'}${t.missing.length ? ` on ${t.missing.join(', ')}` : ''} (record a new inspection; a failed one is never edited)`);
      const n = openNcrs(row, gate.ncrs);
      if (n.length) return refuse(`${n.map(x => x.ncr_no).join(', ')} must be closed first`);
    }
    if (!row.end_date && !(gate && row.qc_only)) return bad('Production has not finished this stage yet');
    const insp = b.inspection_date || date;
    if (!isISODate(insp)) return bad('Invalid inspection date');
    const cert = b.test_certificate_id ? Number(b.test_certificate_id) : null;
    if (cert && !(await queryOne('SELECT 1 FROM test_certificates WHERE id = ?', [cert]))) return bad('Test certificate not found', 404);
    await execute(
      `UPDATE job_sheet_stages SET inspection_date = ?, test_certificate_id = ?, qc_sign_by = ?, qc_sign_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [insp, cert, user.username, stageId]);
    await audit('job_sheet_stage_qc', { actor: user.username, detail: `sheet ${sheetId} · ${row.name}` });
    // Every stage across the project's job_sheet(s) reaching qc_signed collapses the 13 Production
    // milestone keys done together — re-check on every QC sign, since this could be the last one.
    try {
      const sheet = await queryOne('SELECT project_id FROM job_sheets WHERE id = ?', [sheetId]);
      if (sheet?.project_id) await syncProductionFromJobSheets(sheet.project_id, user.username);
    } catch { /* best-effort */ }
    return NextResponse.json({ ok: true });
  }

  // QC may reopen a stage it signed; everything else here is Production's.
  const qcReopen = b.action === 'reopen' && canAccessDepartment(user, 'QC');
  if (b.action === 'send_back') {
    const d0 = requireDepartment(user, 'QC') || (await requireAction(user, 'QC', 'qc.jobsheet.sign'));
    if (d0) return d0;
    const reason = String(b.reason || '').trim();
    if (!reason) return bad('Give a reason for sending it back');
    if (!row.end_date || row.qc_sign_by) return bad('Only a finished, unsigned stage can be sent back');
    await execute(`UPDATE job_sheet_stages SET end_date = NULL, production_sign_by = NULL, production_sign_at = NULL,
      remarks = ? WHERE id = ?`, [`QC sent back: ${reason}`, stageId]);
    await recomputeSheetDates(sheetId);
    await audit('job_sheet_stage_sent_back', { actor: user.username, detail: `sheet ${sheetId} · ${row.name} · ${reason}` });
    try {
      const js0 = await queryOne('SELECT jc_no FROM job_sheets WHERE id = ?', [sheetId]);
      await notifyDepartment('Production', { kind: 'jobsheet_sent_back', title: `QC sent back "${row.name}": ${reason}`, link: tabLink('/production/shop', 'jobcards', { highlight: js0?.jc_no }), dedupe_key: `jobsheet_back:${stageId}:${Date.now()}` });
    } catch { /* best-effort */ }
    return NextResponse.json({ ok: true });
  }
  const denied = qcReopen ? null : (requireDepartment(user, 'Production') || (await requireAction(user, 'Production', 'production.jobsheet.write')));
  if (denied) return denied;
  const locked = row.qc_sign_by && !canAccessDepartment(user, 'QC') && !isPM(user);
  if (locked && b.action !== 'reopen') return bad('QC has signed this stage — QC must reopen it first', 403);
  // ITP gate for anything that records shop work on the point (including typing a date in directly).
  const movesWork = b.action === 'start' || b.action === 'finish' || (b.action === 'edit' && (b.start_date || b.end_date));
  if (gate && movesWork) {
    if (row.qc_only) return refuse('This is a QC review point: QC signs it, there is no shop work to record');
    if (row.not_applicable) return refuse('This point is marked not applicable');
    if (g.blocked) return refuse(`Blocked by ${blockedMessage(g)}`);
    if (pointType(row.point_type) === 'W' && !row.notified_at && !row.start_date) return refuse('Witness point: record that the customer was notified first');
  }

  if (b.action === 'start') {
    const fitter = b.fitter_employee_id ? Number(b.fitter_employee_id) : row.fitter_employee_id;
    if (!fitter && !gate) return bad('Pick the fitter/welder first');
    await execute('UPDATE job_sheet_stages SET fitter_employee_id = ?, start_date = ? WHERE id = ?', [fitter, date, stageId]);
  } else if (b.action === 'finish') {
    if (!row.start_date && !row.fitter_employee_id && !b.fitter_employee_id && !gate) return bad('Start the stage (and pick the fitter/welder) first');
    await execute(
      `UPDATE job_sheet_stages SET start_date = COALESCE(start_date, ?), end_date = ?, fitter_employee_id = COALESCE(?, fitter_employee_id),
              production_sign_by = ?, production_sign_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [date, date, b.fitter_employee_id ? Number(b.fitter_employee_id) : null, user.username, stageId]);
  } else if (b.action === 'reopen') {
    if (locked) return bad('QC has signed this stage — QC must reopen it', 403);
    await execute(
      `UPDATE job_sheet_stages SET end_date = NULL, production_sign_by = NULL, production_sign_at = NULL,
              inspection_date = NULL, test_certificate_id = NULL, qc_sign_by = NULL, qc_sign_at = NULL,
              released_at = NULL, released_by = NULL, release_ref = NULL, not_applicable = 0, na_reason = NULL WHERE id = ?`, [stageId]);
    if (gate) await audit('itp_point_reopened', { actor: user.username, detail: `${gate.sheet.jc_no} · ${row.item_key} ${row.name}` });
  } else if (b.action === 'edit') {
    const sets = [], args = [];
    if ('fitter_employee_id' in b) { sets.push('fitter_employee_id = ?'); args.push(b.fitter_employee_id ? Number(b.fitter_employee_id) : null); }
    for (const k of ['start_date', 'end_date']) if (k in b) {
      if (b[k] && !isISODate(b[k])) return bad(`Invalid ${k}`);
      sets.push(`${k} = ?`); args.push(b[k] || null);
    }
    if ('remarks' in b) { sets.push('remarks = ?'); args.push(String(b.remarks || '').trim() || null); }
    if ('extra_workers' in b) {
      const ids = [...new Set((Array.isArray(b.extra_workers) ? b.extra_workers : []).map(Number).filter(Boolean))];
      await execute('DELETE FROM job_sheet_stage_workers WHERE stage_id = ?', [stageId]);
      for (const eid of ids) await execute('INSERT INTO job_sheet_stage_workers (stage_id, employee_id) VALUES (?, ?)', [stageId, eid]);
    }
    if (!sets.length && 'extra_workers' in b) { await recomputeSheetDates(sheetId); return NextResponse.json({ ok: true }); }
    if (!sets.length) return bad('Nothing to update');
    // Clearing the end date un-finishes the stage, so its production sign goes too.
    if ('end_date' in b && !b.end_date) sets.push('production_sign_by = NULL', 'production_sign_at = NULL');
    await execute(`UPDATE job_sheet_stages SET ${sets.join(', ')} WHERE id = ?`, [...args, stageId]);
  } else return bad('Unknown action');

  await recomputeSheetDates(sheetId);
  // The first stage started (or finished directly) is when shop-floor work really begins: start the
  // Production milestone (Marking/Cutting) — a no-op if it's already started or done.
  if (b.action === 'start' || b.action === 'finish') {
    try {
      const js = await queryOne('SELECT project_id FROM job_sheets WHERE id = ?', [sheetId]);
      if (js?.project_id) await maybeStartProductionForProject(js.project_id, user.username);
    } catch { /* best-effort */ }
  }
  // The Dispatch stage is where the finished job moves to the packing list: tell Dispatch the moment
  // it is started (or finished directly), once per job card.
  if ((b.action === 'start' || b.action === 'finish') && isDispatchStage(row.name)) {
    try {
      const js = await queryOne('SELECT jc_no, job_number, project_id FROM job_sheets WHERE id = ?', [sheetId]);
      await notifyDepartment('Dispatch', { kind: 'jobsheet_dispatch', project_id: js.project_id,
        title: `Job card ${js.job_number || js.jc_no} is at Dispatch — pack its items`,
        body: 'Open Dispatch > Pending Items to put this project\'s finished items on a packing list.',
        link: tabLink('/dispatch', 'pending', { q: (await queryOne('SELECT project_no FROM projects WHERE id = ?', [js.project_id]))?.project_no }),
        dedupe_key: `jobsheet_dispatch:${sheetId}` });
    } catch { /* best-effort */ }
  }
  if (b.action === 'finish') {
    // One QC alert per job per day (not one per stage).
    try {
      const js = await queryOne('SELECT jc_no, job_number, project_id FROM job_sheets WHERE id = ?', [sheetId]);
      await notifyDepartment('QC', { kind: 'jobsheet_qc', title: `Job card ${js.job_number || js.jc_no}: stage(s) finished, waiting for QC sign`,
        project_id: js.project_id, link: tabLink('/qc', 'jobsheet-approvals', { q: js.jc_no }), dedupe_key: `jobsheet_qc:${sheetId}:${todayISO()}` });
    } catch { /* best-effort */ }
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req, props) {
  const params = await props.params;
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Production') || (await requireAction(user, 'Production', 'production.jobsheet.write'));
  if (denied) return denied;
  const sheetId = Number(params.id), stageId = Number(params.stageId);
  const row = await queryOne('SELECT qc_sign_by FROM job_sheet_stages WHERE id = ? AND sheet_id = ?', [stageId, sheetId]);
  if (!row) return bad('Stage not found', 404);
  if (await loadSheetGate(sheetId)) return bad('ITP points come from the template: mark it not applicable instead', 409);
  if (row.qc_sign_by) return bad('QC has signed this stage — it cannot be removed', 409);
  await execute('DELETE FROM job_sheet_stages WHERE id = ?', [stageId]);
  await recomputeSheetDates(sheetId);
  return NextResponse.json({ ok: true });
}
