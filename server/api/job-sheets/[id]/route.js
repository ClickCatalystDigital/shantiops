import { NextResponse } from 'next/server';
import { execute, queryOne, queryAll } from '@/lib/db';
import { loadSheetGate } from '@/lib/quality';
import { getFreshSessionUser, requireDepartment, canAccessDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { getJobSheetDetail } from '@/lib/data';
import { isISODate } from '@/lib/job-sheets';
import { audit } from '@/lib/usb';
import { deleteObject } from '@/lib/r2';

export async function GET(_req, props) {
  const params = await props.params;
  const user = await getFreshSessionUser();
  if (!canAccessDepartment(user, 'Production') && !canAccessDepartment(user, 'QC')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const d = await getJobSheetDetail(Number(params.id));
  if (!d) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  // ITP card: the gate state of every point, its inspections (with measured values), NCRs and the welds.
  const gate = await loadSheetGate(d.id);
  if (gate) {
    const ids = gate.records.map(r => r.id);
    const [records, measurements] = ids.length ? await Promise.all([
      queryAll(`SELECT id, job_sheet_stage_id, weld_id, test_type, result, supersedes_id, reference_no, inspector, tested_on, notes,
        created_by, created_at, report_key IS NOT NULL AS has_report FROM qc_records WHERE id IN (${ids.map(() => '?').join(',')}) ORDER BY id`, ids),
      queryAll(`SELECT m.*, r.min, r.max, r.min_inclusive, r.max_inclusive, r.unit AS rule_unit, r.source AS rule_source, r.version AS rule_version
        FROM qc_measurements m LEFT JOIN acceptance_rules r ON r.id = m.rule_id WHERE m.qc_record_id IN (${ids.map(() => '?').join(',')})`, ids),
    ]) : [[], []];
    d.itp = { states: gate.states, records: records.map(r => ({ ...r, measurements: measurements.filter(m => m.qc_record_id === r.id) })),
      ncrs: gate.ncrs, welds: gate.welds };
  }
  return NextResponse.json(d);
}

const TEXT = ['job_number', 'ibr_bvi', 'drg_nos', 'boiler_plate_nos', 'notes', 'owner_name'];

// Header edits + the two sheet-level signatures (Production I/C, QC).
export async function PATCH(req, props) {
  const params = await props.params;
  const user = await getFreshSessionUser();
  const id = Number(params.id);
  const b = await req.json();
  if (!(await queryOne('SELECT 1 FROM job_sheets WHERE id = ?', [id]))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (b.sign === 'qc') {
    const denied = requireDepartment(user, 'QC') || (await requireAction(user, 'QC', 'qc.jobsheet.sign'));
    if (denied) return denied;
    await execute('UPDATE job_sheets SET qc_sign_by = ?, qc_sign_at = CURRENT_TIMESTAMP WHERE id = ?', [user.username, id]);
    await audit('job_sheet_qc_signed', { actor: user.username, detail: `sheet ${id}` });
    return NextResponse.json({ ok: true });
  }
  const denied = requireDepartment(user, 'Production') || (await requireAction(user, 'Production', 'production.jobsheet.write'));
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
  if ('project_id' in b) {
    const itp = await queryOne(`SELECT 1 FROM job_sheets js WHERE js.id = ? AND js.itp_template_id IS NOT NULL AND EXISTS
      (SELECT 1 FROM qc_records r JOIN job_sheet_stages s ON s.id = r.job_sheet_stage_id WHERE s.sheet_id = js.id)`, [id]);
    if (itp) return NextResponse.json({ error: 'Inspections are recorded against this project: the card cannot move' }, { status: 409 });
    sets.push('project_id = ?'); args.push(b.project_id ? Number(b.project_id) : null);
  }
  for (const k of ['customer_po', 'item_number']) if (k in b) { sets.push(`${k} = ?`); args.push(String(b[k] ?? '').trim() || null); }
  if (!sets.length) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
  await execute(`UPDATE job_sheets SET ${sets.join(', ')} WHERE id = ?`, [...args, id]);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req, props) {
  const params = await props.params;
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Production') || (await requireAction(user, 'Production', 'production.jobsheet.write'));
  if (denied) return denied;
  const id = Number(params.id);
  const sheet = await queryOne('SELECT jc_no, scan_key FROM job_sheets WHERE id = ?', [id]);
  if (!sheet) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  // An ITP card's inspection history and NCRs point at its rows: it is kept once anything is recorded on it.
  const used = await queryOne(`SELECT 1 FROM job_sheet_stages s WHERE s.sheet_id = ? AND (s.qc_sign_by IS NOT NULL
      OR EXISTS (SELECT 1 FROM qc_records r WHERE r.job_sheet_stage_id = s.id) OR EXISTS (SELECT 1 FROM ncr_records n WHERE n.job_sheet_stage_id = s.id)) LIMIT 1`, [id]);
  if (used) return NextResponse.json({ error: 'This card has inspections, signatures or NCRs recorded: it cannot be deleted' }, { status: 409 });
  if (sheet.scan_key) await deleteObject(sheet.scan_key).catch(() => {}); // don't orphan the scan in R2
  await execute('DELETE FROM job_sheet_stages WHERE sheet_id = ?', [id]);
  await execute('DELETE FROM job_sheets WHERE id = ?', [id]);
  await audit('job_sheet_deleted', { actor: user.username, detail: sheet.jc_no });
  return NextResponse.json({ ok: true });
}
