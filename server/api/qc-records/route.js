import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, canAccessDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { audit } from '@/lib/usb';
import { syncHydroTestMilestone } from '@/lib/milestone-auto';

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

  const project = await queryOne('SELECT id FROM projects WHERE id = ?', [b.project_id]);
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

  const result = ['pass', 'fail', 'pending'].includes(b.result) ? b.result : 'pending';
  const res = await execute(
    `INSERT INTO qc_records (project_id, test_type, reference_no, result, inspector, tested_on, notes, created_by,
       bom_item_id, work_order_id, assembly_id, dispatch_eligible)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [b.project_id, b.test_type.trim(), b.reference_no?.trim() || null, result,
      b.inspector?.trim() || null, b.tested_on || null, b.notes?.trim() || null, user.username,
      b.bom_item_id ? Number(b.bom_item_id) : null, b.work_order_id ? Number(b.work_order_id) : null,
      b.assembly_id ? Number(b.assembly_id) : null, b.dispatch_eligible ? 1 : 0]);

  await audit('qc_record_add', {
    actor: user.username,
    detail: JSON.stringify({ qc_record_id: Number(res.lastId), project_id: b.project_id, test_type: b.test_type.trim() }),
  });
  if (/hydro/i.test(b.test_type) && result === 'pass') {
    await syncHydroTestMilestone(b.project_id, user.username);
  }
  return NextResponse.json({ id: Number(res.lastId) });
}
