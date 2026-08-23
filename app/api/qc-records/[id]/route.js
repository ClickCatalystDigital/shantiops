import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, canAccessDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { notifyDepartment } from '@/lib/notify';
import { audit } from '@/lib/usb';
import { syncHydroTestMilestone } from '@/lib/milestone-auto';

const EDITABLE = ['test_type', 'reference_no', 'result', 'inspector', 'tested_on', 'notes', 'dispatch_eligible'];

// Hydro Test ownership transferred QC -> Production (lib/milestones.js, PRODUCTION-MODULE-DESIGN.md
// §3.5) — completely, not shared: a hydro-test record is Production's to edit/delete, everything
// else (radiography/NDE, MTC, freeform) stays QC's, same table, split by test_type since there's
// no separate hydro table to move.
function canTouch(user, testType) {
  return /hydro/i.test(testType || '') ? canAccessDepartment(user, 'Production') : canAccessDepartment(user, 'QC');
}

// Edits a record — most commonly flipping result from pending to pass/fail once the test's back,
// or filling in reference_no once the cert number is issued.
export async function PATCH(req, { params }) {
  const user = await getFreshSessionUser();
  const record = await queryOne('SELECT * FROM qc_records WHERE id = ?', [params.id]);
  if (!record) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!canTouch(user, record.test_type)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (!/hydro/i.test(record.test_type)) {
    const actionDenied = await requireAction(user, 'QC', 'qc.test.write');
    if (actionDenied) return actionDenied;
  }

  const b = await req.json();
  const keys = Object.keys(b).filter(k => EDITABLE.includes(k));
  if (!keys.length) return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  if (keys.includes('test_type') && !String(b.test_type || '').trim()) {
    return NextResponse.json({ error: 'Test type cannot be empty' }, { status: 400 });
  }
  if (keys.includes('result') && !['pass', 'fail', 'pending'].includes(b.result)) {
    return NextResponse.json({ error: 'Invalid result' }, { status: 400 });
  }

  const changed = {};
  for (const k of keys) {
    if (k === 'dispatch_eligible') { changed[k] = b[k] ? 1 : 0; continue; }
    let v = typeof b[k] === 'string' ? b[k].trim() : b[k];
    if (v === '') v = null;
    changed[k] = v;
  }
  await execute(
    `UPDATE qc_records SET ${Object.keys(changed).map(k => `${k} = ?`).join(', ')} WHERE id = ?`,
    [...Object.values(changed), params.id]);

  const testType = changed.test_type ?? record.test_type;
  const result = changed.result ?? record.result;
  if (/hydro/i.test(testType) && result === 'pass') {
    await syncHydroTestMilestone(record.project_id, user.username);
  }
  // QC failure signal. Only fires on the pending/pass -> fail transition (dedupe_key one-shot per
  // record; ponytail: a fail->retest->fail cycle won't re-fire — add a counter to the key if that's
  // ever needed). A failed *incoming* inspection (bom_item_id set) is bad material for Procurement
  // to replace; any other failure is a build defect for Production to rework.
  if (record.result !== 'fail' && result === 'fail') {
    try {
      const proj = await queryOne('SELECT project_no FROM projects WHERE id = ?', [record.project_id]);
      const pno = proj?.project_no || '';
      const dept = record.bom_item_id ? 'Procurement' : 'Production';
      await notifyDepartment(dept, {
        kind: 'qc_fail', title: `QC FAILED: ${testType} — ${pno}`,
        body: record.bom_item_id ? 'Incoming inspection failed — material needs replacement.'
                                 : 'Inspection failed — raise an NCR.',
        dedupe_key: `qc_fail:${record.id}`,
      });
    } catch (err) { /* notification is best-effort */ }
  }

  await audit('qc_record_edit', {
    actor: user.username,
    detail: JSON.stringify({ qc_record_id: Number(params.id), project_id: record.project_id, changed }),
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req, { params }) {
  const user = await getFreshSessionUser();
  const record = await queryOne('SELECT * FROM qc_records WHERE id = ?', [params.id]);
  if (!record) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!canTouch(user, record.test_type)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (!/hydro/i.test(record.test_type)) {
    const actionDenied = await requireAction(user, 'QC', 'qc.test.delete');
    if (actionDenied) return actionDenied;
  }

  await execute('DELETE FROM qc_records WHERE id = ?', [params.id]);
  await audit('qc_record_delete', {
    actor: user.username,
    detail: JSON.stringify({ qc_record_id: Number(params.id), project_id: record.project_id, test_type: record.test_type }),
  });
  return NextResponse.json({ ok: true });
}
