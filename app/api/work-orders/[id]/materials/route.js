// Work Order material requirements (STERP items 21/27 material link). A line either points at a
// real project BOM line (bom_item_id — its actual issued qty is read live off material_issues, see
// getWorkOrderDetail) or, for against_stock Work Orders with no BOM, carries its own item_id/
// description and is tracked with the manual qty_issued column on this table.
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

  const wo = await queryOne('SELECT id FROM work_orders WHERE id = ?', [params.id]);
  if (!wo) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const b = await req.json();
  const qtyRequired = Number(b.qty_required) || 0;
  if (qtyRequired <= 0) return NextResponse.json({ error: 'Quantity required must be greater than 0' }, { status: 400 });
  if (!b.bom_item_id && !b.item_id && !String(b.description || '').trim()) {
    return NextResponse.json({ error: 'Pick a BOM line, an Item Master item, or enter a description' }, { status: 400 });
  }

  const { lastId } = await execute(
    `INSERT INTO work_order_materials (work_order_id, bom_item_id, item_id, description, qty_required, unit_cost)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      params.id, b.bom_item_id ? Number(b.bom_item_id) : null, b.item_id ? Number(b.item_id) : null,
      String(b.description || '').trim() || null, qtyRequired, b.unit_cost != null ? Number(b.unit_cost) : null,
    ]
  );
  await audit('work_order_material_added', { actor: user.username, detail: `WO #${params.id} · line #${lastId}` });
  return NextResponse.json({ id: Number(lastId) });
}
