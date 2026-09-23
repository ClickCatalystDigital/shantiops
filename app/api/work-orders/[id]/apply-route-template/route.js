// Applies a saved Process Route Card template onto this (still-draft) Work Order — same draft-only
// guard as the single-step add route (app/api/work-orders/[id]/operations/route.js), and the same
// "continue the existing sequence" behavior: additive, never blocks on steps already present.
import { NextResponse } from 'next/server';
import { execute, queryAll, queryOne } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { audit } from '@/lib/usb';

export async function POST(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Production');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Production', 'production.workorder.edit');
  if (actionDenied) return actionDenied;

  const wo = await queryOne('SELECT id, project_id, status FROM work_orders WHERE id = ?', [params.id]);
  if (!wo) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (wo.status !== 'draft') {
    return NextResponse.json({ error: 'Work Order is past draft — route changes need a Change Note' }, { status: 400 });
  }

  const b = await req.json();
  const templateId = Number(b.template_id);
  if (!templateId) return NextResponse.json({ error: 'template_id is required' }, { status: 400 });

  const items = await queryAll(
    'SELECT * FROM work_order_route_template_items WHERE template_id = ? ORDER BY seq, id', [templateId]
  );
  if (!items.length) return NextResponse.json({ error: 'Template not found or has no steps' }, { status: 404 });

  const seqRow = await queryOne('SELECT COALESCE(MAX(seq), 0) AS v FROM work_order_operations WHERE work_order_id = ?', [params.id]);
  let seq = seqRow.v || 0;
  for (const item of items) {
    seq++;
    let milestoneId = null;
    if (item.milestone_key && wo.project_id) {
      const m = await queryOne(
        'SELECT id FROM milestones WHERE project_id = ? AND milestone_key = ?', [wo.project_id, item.milestone_key]
      );
      milestoneId = m?.id || null;
    }
    await execute(
      `INSERT INTO work_order_operations
         (work_order_id, seq, operation_id, workstation_id, milestone_id, department, planned_minutes, quality_checkpoint)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [params.id, seq, item.operation_id, item.workstation_id, milestoneId, item.department, item.planned_minutes, item.quality_checkpoint]
    );
  }
  await audit('work_order_route_template_applied', { actor: user.username, detail: `WO #${params.id} · template #${templateId} · ${items.length} step(s)` });
  return NextResponse.json({ created: items.length });
}
