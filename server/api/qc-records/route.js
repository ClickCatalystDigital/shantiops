import { NextResponse } from 'next/server';
import { execute, queryOne, queryAll, withTransaction } from '@/lib/db';
import { getFreshSessionUser, canAccessDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { audit } from '@/lib/usb';
import { notifyDepartment } from '@/lib/notify';
import { tabLink } from '@/lib/alert-links.mjs';
import { syncHydroTestMilestone } from '@/lib/milestone-auto';
import { loadSheetGate, stateOf } from '@/lib/quality';
import { blockedMessage, latestRecords } from '@/lib/quality-gate.mjs';
import { evaluate } from '@/lib/acceptance.mjs';

// Hydro Test ownership transferred QC -> Production (lib/milestones.js) — a new hydro-test record
// is Production's to create; everything else (radiography/NDE, MTC, freeform) stays QC's.
function canTouch(user, testType) {
  return /hydro/i.test(testType || '') ? canAccessDepartment(user, 'Production') : canAccessDepartment(user, 'QC');
}

// Logs a test/inspection — hydro test, radiography/NDE, material test certificate, etc.
export async function POST(req) {
  const user = await getFreshSessionUser();
  const b = await req.json();
  if (!b.project_id || !b.test_type?.trim()) {
    return NextResponse.json({ error: 'project_id and test_type are required' }, { status: 400 });
  }
  if (!canTouch(user, b.test_type)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  // Hydro is Production's own action (out of scope until Production is wired) — only QC's own
  // non-hydro test types go through the Responsibility gate here.
  if (!/hydro/i.test(b.test_type)) {
    const actionDenied = await requireAction(user, 'QC', 'qc.test.write');
    if (actionDenied) return actionDenied;
  }

  // An inspection on an ITP point: the project comes from the card, never the request.
  let stage = null, supersedes = null, weldId = b.weld_id ? Number(b.weld_id) : null;
  if (b.job_sheet_stage_id) {
    stage = await queryOne('SELECT s.*, js.project_id AS sheet_project_id FROM job_sheet_stages s JOIN job_sheets js ON js.id = s.sheet_id WHERE s.id = ?', [Number(b.job_sheet_stage_id)]);
    if (!stage) return NextResponse.json({ error: 'ITP point not found' }, { status: 404 });
    b.project_id = stage.sheet_project_id;
    const gate = await loadSheetGate(stage.sheet_id);
    if (!gate) return NextResponse.json({ error: 'That card has no ITP' }, { status: 400 });
    const g = stateOf(gate, stage.id);
    if (stage.not_applicable) return NextResponse.json({ error: 'This point is marked not applicable' }, { status: 409 });
    if (stage.qc_sign_by) return NextResponse.json({ error: 'This point is already QC-signed — reopen it to record another inspection' }, { status: 409 });
    if (g.blocked) return NextResponse.json({ error: `Blocked by ${blockedMessage(g)}` }, { status: 409 });
    if (weldId && !gate.welds.some(w => w.id === weldId)) return NextResponse.json({ error: "That weld is not on this project's weld register" }, { status: 400 });
    if (stage.per_weld && !weldId) return NextResponse.json({ error: 'Pick the weld this inspection covers' }, { status: 400 });
    const prev = latestRecords(stage, gate.records).find(r => (r.weld_id ?? null) === weldId && r.test_type.trim().toUpperCase() === b.test_type.trim().toUpperCase());
    supersedes = prev ? prev.id : null;
  } else if (weldId) {
    return NextResponse.json({ error: 'A weld is only recorded on an ITP inspection' }, { status: 400 });
  }

  const project = await queryOne('SELECT p.id, p.project_no, p.customer_name FROM projects p WHERE p.id = ?', [b.project_id]);
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

  // Measured values: each is checked against the active acceptance rule for its characteristic.
  const raw = Array.isArray(b.measurements) ? b.measurements.filter(m => String(m.characteristic || '').trim() || String(m.value ?? '').trim()) : [];
  const ev = evaluate(raw, raw.length ? await queryAll('SELECT * FROM acceptance_rules WHERE retired_at IS NULL') : [],
    { project: project.project_no, customer: project.customer_name, material: b.material });
  if (ev.errors.length) return NextResponse.json({ error: ev.errors.join('; ') }, { status: 400 });
  let result = ['pass', 'fail', 'pending'].includes(b.result) ? b.result : null;
  if (ev.anyFail && result === 'pass') return NextResponse.json({ error: 'A measured value is outside its acceptance rule: this inspection cannot pass' }, { status: 409 });
  if (ev.anyFail) result = 'fail';
  if (!result) result = ev.rows.length && ev.rows.every(r => r.verdict === 'pass') ? 'pass' : 'pending';

  const id = await withTransaction(async tx => {
    const r = await tx.execute({
      sql: `INSERT INTO qc_records (project_id, test_type, reference_no, result, inspector, tested_on, notes, created_by,
         bom_item_id, work_order_id, assembly_id, dispatch_eligible, job_sheet_stage_id, weld_id, supersedes_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [b.project_id, b.test_type.trim(), b.reference_no?.trim() || null, result,
        b.inspector?.trim() || null, b.tested_on || null, b.notes?.trim() || null, user.username,
        b.bom_item_id ? Number(b.bom_item_id) : null, b.work_order_id ? Number(b.work_order_id) : null,
        b.assembly_id ? Number(b.assembly_id) : null, b.dispatch_eligible ? 1 : 0, stage ? stage.id : null, weldId, supersedes] });
    const recId = Number(r.lastInsertRowid);
    for (const m of ev.rows) {
      await tx.execute({ sql: `INSERT INTO qc_measurements (qc_record_id, characteristic, value, unit, location, rule_id, verdict, calibration_item_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, args: [recId, String(m.characteristic).trim(), Number(m.value), String(m.unit || '').trim(),
        String(m.location || '').trim() || null, m.rule_id, m.verdict, m.calibration_item_id ? Number(m.calibration_item_id) : null] });
    }
    return recId;
  });
  const res = { lastId: id };

  await audit('qc_record_add', {
    actor: user.username,
    detail: JSON.stringify({ qc_record_id: id, project_id: b.project_id, test_type: b.test_type.trim(), result, stage: stage?.item_key, weld_id: weldId, supersedes_id: supersedes }),
  });
  if (/hydro/i.test(b.test_type) && result === 'pass') {
    await syncHydroTestMilestone(b.project_id, user.username);
  }
  if (result === 'fail' && stage) {
    try {
      await notifyDepartment('QC', { kind: 'qc_fail', title: `${b.test_type.trim()} FAILED on ${project.project_no} point ${stage.item_key}`,
        body: 'Raise an NCR. Points that depend on it stay blocked until it is closed and a new inspection passes.',
        project_id: project.id, link: tabLink('/qc', 'holds'), dedupe_key: `qc_fail:${id}` });
    } catch { /* best-effort */ }
  }
  return NextResponse.json({ id, result, measurements: ev.rows });
}
