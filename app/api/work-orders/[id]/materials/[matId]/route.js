import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { audit } from '@/lib/usb';

// Manual "Log issue" — only meaningful for a line with no bom_item_id (against_stock materials,
// which have no material_issues row to read a real qty from, unlike a BOM-linked line).
export async function PATCH(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Production');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Production', 'production.workorder.edit');
  if (actionDenied) return actionDenied;

  const line = await queryOne(
    'SELECT id, bom_item_id, qty_issued FROM work_order_materials WHERE id = ? AND work_order_id = ?',
    [params.matId, params.id]
  );
  if (!line) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (line.bom_item_id) {
    return NextResponse.json({ error: 'This line is linked to a BOM item — issued quantity comes from Stores, not a manual log' }, { status: 400 });
  }

  const b = await req.json();
  const qtyIssued = Number(b.qty_issued);
  if (!Number.isFinite(qtyIssued) || qtyIssued < 0) {
    return NextResponse.json({ error: 'Invalid quantity issued' }, { status: 400 });
  }
  await execute('UPDATE work_order_materials SET qty_issued = ? WHERE id = ?', [qtyIssued, params.matId]);
  await audit('work_order_material_issued', { actor: user.username, detail: `line #${params.matId} · qty ${qtyIssued}` });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Production');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Production', 'production.workorder.edit');
  if (actionDenied) return actionDenied;

  const line = await queryOne('SELECT id FROM work_order_materials WHERE id = ? AND work_order_id = ?', [params.matId, params.id]);
  if (!line) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  await execute('DELETE FROM work_order_materials WHERE id = ?', [params.matId]);
  await audit('work_order_material_deleted', { actor: user.username, detail: `line #${params.matId}` });
  return NextResponse.json({ ok: true });
}
