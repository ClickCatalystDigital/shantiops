// Work Order detail + draft edits + status transitions. Once a Work Order is past 'draft', its
// baseline fields (qty_planned/planned_start/planned_end/product_description) are locked — use
// POST .../change-notes (item 28) instead of silently moving the baseline.
import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { getWorkOrderDetail } from '@/lib/data';
import { audit } from '@/lib/usb';

const BASELINE_FIELDS = ['qty_planned', 'planned_start', 'planned_end', 'product_description'];
const TRANSITIONS = {
  draft: ['released', 'cancelled'],
  released: ['in_progress', 'cancelled'],
  in_progress: ['completed', 'cancelled'],
};

export async function GET(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Production');
  if (denied) return denied;
  const detail = await getWorkOrderDetail(params.id);
  if (!detail) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(detail);
}

export async function PATCH(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Production');
  if (denied) return denied;

  const wo = await queryOne('SELECT id, status FROM work_orders WHERE id = ?', [params.id]);
  if (!wo) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const b = await req.json();

  if (b.status) {
    const actionDenied = await requireAction(user, 'Production', 'production.workorder.release');
    if (actionDenied) return actionDenied;
    if (!(TRANSITIONS[wo.status] || []).includes(b.status)) {
      return NextResponse.json({ error: `Cannot move a ${wo.status} Work Order to ${b.status}` }, { status: 400 });
    }
    await execute(
      'UPDATE work_orders SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [b.status, params.id]
    );
    await audit('work_order_status_changed', { actor: user.username, detail: `#${params.id} · ${wo.status} → ${b.status}` });
    return NextResponse.json({ ok: true });
  }

  const actionDenied = await requireAction(user, 'Production', 'production.workorder.edit');
  if (actionDenied) return actionDenied;
  const keys = Object.keys(b).filter(k => ['notes', ...BASELINE_FIELDS].includes(k));
  if (!keys.length) return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  const lockedKeys = keys.filter(k => BASELINE_FIELDS.includes(k));
  if (lockedKeys.length && wo.status !== 'draft') {
    return NextResponse.json({ error: 'Work Order is past draft — use a Change Note to edit ' + lockedKeys.join(', ') }, { status: 400 });
  }

  const fields = ['updated_at = CURRENT_TIMESTAMP'];
  const args = [];
  for (const k of keys) {
    fields.push(`${k} = ?`);
    args.push(k === 'qty_planned' ? (Number(b[k]) || 0) : (String(b[k] || '').trim() || null));
  }
  args.push(params.id);
  await execute(`UPDATE work_orders SET ${fields.join(', ')} WHERE id = ?`, args);
  await audit('work_order_updated', { actor: user.username, detail: `#${params.id} · ${keys.join(',')}` });
  return NextResponse.json({ ok: true });
}
