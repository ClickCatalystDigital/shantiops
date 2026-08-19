// Process Route Card lines (STERP item 24) for one Work Order — operation sequence, work centre,
// planned time, department, inputs/outputs, quality checkpoint. Route can only be built/reshaped
// while the Work Order is still 'draft' — once released, routing is a baseline field, changed only
// through a Change Note (item 28), same lock as the Work Order's own qty/dates.
import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { audit } from '@/lib/usb';

export async function POST(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Production');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Production', 'production.workorder.edit');
  if (actionDenied) return actionDenied;

  const wo = await queryOne('SELECT id, status FROM work_orders WHERE id = ?', [params.id]);
  if (!wo) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (wo.status !== 'draft') {
    return NextResponse.json({ error: 'Work Order is past draft — route changes need a Change Note' }, { status: 400 });
  }

  const b = await req.json();
  const seqRow = await queryOne('SELECT COALESCE(MAX(seq), 0) AS v FROM work_order_operations WHERE work_order_id = ?', [params.id]);
  const { lastId } = await execute(
    `INSERT INTO work_order_operations
       (work_order_id, seq, operation_id, workstation_id, milestone_id, department, planned_minutes,
        inputs, outputs, quality_checkpoint)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      params.id, (seqRow.v || 0) + 1,
      b.operation_id ? Number(b.operation_id) : null, b.workstation_id ? Number(b.workstation_id) : null,
      b.milestone_id ? Number(b.milestone_id) : null, String(b.department || '').trim() || null,
      Number(b.planned_minutes) || 0, String(b.inputs || '').trim() || null,
      String(b.outputs || '').trim() || null, String(b.quality_checkpoint || '').trim() || null,
    ]
  );
  await audit('work_order_operation_added', { actor: user.username, detail: `WO #${params.id} · step #${lastId}` });
  return NextResponse.json({ id: Number(lastId) });
}
