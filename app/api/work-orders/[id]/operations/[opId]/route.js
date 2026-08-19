import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { audit } from '@/lib/usb';

const BASELINE_FIELDS = ['operation_id', 'workstation_id', 'milestone_id', 'department', 'planned_minutes', 'inputs', 'outputs'];
const ALWAYS_EDITABLE = ['status', 'quality_checkpoint'];

export async function PATCH(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Production');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Production', 'production.workorder.edit');
  if (actionDenied) return actionDenied;

  const op = await queryOne(
    `SELECT wop.id, wo.status AS wo_status FROM work_order_operations wop
       JOIN work_orders wo ON wo.id = wop.work_order_id WHERE wop.id = ? AND wop.work_order_id = ?`,
    [params.opId, params.id]
  );
  if (!op) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const b = await req.json();
  const keys = Object.keys(b).filter(k => [...BASELINE_FIELDS, ...ALWAYS_EDITABLE].includes(k));
  if (!keys.length) return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  const lockedKeys = keys.filter(k => BASELINE_FIELDS.includes(k));
  if (lockedKeys.length && op.wo_status !== 'draft') {
    return NextResponse.json({ error: 'Work Order is past draft — route changes need a Change Note' }, { status: 400 });
  }

  const fields = [];
  const args = [];
  for (const k of keys) {
    fields.push(`${k} = ?`);
    args.push(typeof b[k] === 'number' || k === 'planned_minutes' ? (Number(b[k]) || 0) : (String(b[k] || '').trim() || null));
  }
  args.push(params.opId);
  await execute(`UPDATE work_order_operations SET ${fields.join(', ')} WHERE id = ?`, args);
  await audit('work_order_operation_updated', { actor: user.username, detail: `step #${params.opId} · ${keys.join(',')}` });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Production');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Production', 'production.workorder.edit');
  if (actionDenied) return actionDenied;

  const op = await queryOne(
    `SELECT wop.id, wo.status AS wo_status FROM work_order_operations wop
       JOIN work_orders wo ON wo.id = wop.work_order_id WHERE wop.id = ? AND wop.work_order_id = ?`,
    [params.opId, params.id]
  );
  if (!op) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (op.wo_status !== 'draft') {
    return NextResponse.json({ error: 'Work Order is past draft — route changes need a Change Note' }, { status: 400 });
  }
  await execute('DELETE FROM work_order_operations WHERE id = ?', [params.opId]);
  await audit('work_order_operation_deleted', { actor: user.username, detail: `step #${params.opId}` });
  return NextResponse.json({ ok: true });
}
