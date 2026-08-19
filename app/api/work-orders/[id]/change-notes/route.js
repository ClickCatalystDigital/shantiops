// Work Order Change Note (STERP item 28) — the only way to move a released Work Order's baseline
// (qty_planned/planned_start/planned_end/product_description). Applies the field change and logs
// old/new/reason in one transaction-shaped pair of writes, same "log the change, then make it"
// pattern as everywhere else in this app that needs an audit trail on a field, not a separate table
// nobody keeps in sync.
import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { getWorkOrderDetail } from '@/lib/data';
import { audit } from '@/lib/usb';

const FIELDS = ['qty_planned', 'planned_start', 'planned_end', 'product_description'];

export async function POST(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Production');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Production', 'production.workorder.change_note');
  if (actionDenied) return actionDenied;

  const wo = await queryOne('SELECT * FROM work_orders WHERE id = ?', [params.id]);
  if (!wo) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (wo.status === 'draft') {
    return NextResponse.json({ error: 'Work Order is still draft — edit it directly, no Change Note needed yet' }, { status: 400 });
  }

  const b = await req.json();
  if (!FIELDS.includes(b.field)) return NextResponse.json({ error: 'Unknown field' }, { status: 400 });
  if (!String(b.reason || '').trim()) return NextResponse.json({ error: 'Reason is required' }, { status: 400 });

  const oldValue = wo[b.field];
  const newValue = b.field === 'qty_planned' ? (Number(b.new_value) || 0) : (String(b.new_value || '').trim() || null);
  if (b.field === 'qty_planned' && newValue <= 0) {
    return NextResponse.json({ error: 'Planned quantity must be greater than 0' }, { status: 400 });
  }

  await execute(`UPDATE work_orders SET ${b.field} = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [newValue, params.id]);
  await execute(
    `INSERT INTO work_order_change_notes (work_order_id, field_changed, old_value, new_value, reason, created_by)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [params.id, b.field, oldValue == null ? null : String(oldValue), newValue == null ? null : String(newValue), b.reason.trim(), user.username]
  );
  await audit('work_order_change_note', { actor: user.username, detail: `WO #${params.id} · ${b.field}: ${oldValue} → ${newValue}` });
  return NextResponse.json(await getWorkOrderDetail(params.id));
}
