// Work Orders (STERP items 21-23, SYSTEM.md §5l) — the parent production-control entity above Job
// Cards. against_order links to a project (and its sale order); against_stock is a replenishment
// order with no customer project. List/create, Production + PM, same shape as job-cards' own route.
import { NextResponse } from 'next/server';
import { execute, queryOne, nextNumber } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { getWorkOrders } from '@/lib/data';
import { audit } from '@/lib/usb';

export async function GET(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Production');
  if (denied) return denied;
  const params = new URL(req.url).searchParams;
  return NextResponse.json(await getWorkOrders({
    status: params.get('status'), mode: params.get('mode'), projectId: params.get('project_id'),
  }));
}

export async function POST(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Production');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Production', 'production.workorder.create');
  if (actionDenied) return actionDenied;

  const b = await req.json();
  const mode = b.mode === 'against_stock' ? 'against_stock' : 'against_order';
  const qtyPlanned = Number(b.qty_planned) || 0;
  if (qtyPlanned <= 0) return NextResponse.json({ error: 'Planned quantity must be greater than 0' }, { status: 400 });

  let projectId = null;
  let saleOrderId = null;
  let bomReleaseRevision = null;
  if (mode === 'against_order') {
    projectId = Number(b.project_id) || null;
    if (!projectId) return NextResponse.json({ error: 'Project is required for a Work Order against an order' }, { status: 400 });
    const project = await queryOne('SELECT id, sale_order_id, bom_release_revision FROM projects WHERE id = ?', [projectId]);
    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    saleOrderId = project.sale_order_id || null;
    bomReleaseRevision = project.bom_release_revision || null;
  } else if (!String(b.product_description || '').trim()) {
    return NextResponse.json({ error: 'Product description is required for a stock Work Order' }, { status: 400 });
  }

  const woNo = await nextNumber('wo_no', 'WO');
  const { lastId } = await execute(
    `INSERT INTO work_orders
       (wo_no, project_id, sale_order_id, mode, product_description, qty_planned,
        bom_release_revision, planned_start, planned_end, notes, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      woNo, projectId, saleOrderId, mode, String(b.product_description || '').trim() || null,
      qtyPlanned, bomReleaseRevision, b.planned_start || null, b.planned_end || null,
      String(b.notes || '').trim() || null, user.username,
    ]
  );
  await audit('work_order_created', { actor: user.username, detail: `${woNo} · ${mode}` });
  return NextResponse.json({ id: Number(lastId), wo_no: woNo });
}
