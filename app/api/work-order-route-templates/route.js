// Reusable Process Route Card templates (§5l addendum) — list, and "save as template" from an
// existing Work Order's current route (mirrors bom_structure_templates' own "captured from a real
// built structure" precedent, not typed from scratch).
import { NextResponse } from 'next/server';
import { execute, queryAll } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { getWorkOrderRouteTemplates } from '@/lib/data';
import { audit } from '@/lib/usb';

export async function GET() {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Production');
  if (denied) return denied;
  return NextResponse.json(await getWorkOrderRouteTemplates());
}

export async function POST(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Production');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Production', 'production.settings.write');
  if (actionDenied) return actionDenied;

  const b = await req.json();
  const name = String(b.name || '').trim();
  if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 });
  const fromWorkOrderId = b.from_work_order_id ? Number(b.from_work_order_id) : null;
  if (!fromWorkOrderId) return NextResponse.json({ error: 'from_work_order_id is required' }, { status: 400 });

  // Resolve each step's real milestone back to its abstract key — a template is project-agnostic,
  // it can't point at a concrete milestone row.
  const steps = await queryAll(
    `SELECT wop.seq, wop.operation_id, wop.workstation_id, wop.department, wop.planned_minutes,
            wop.quality_checkpoint, m.milestone_key
       FROM work_order_operations wop
       LEFT JOIN milestones m ON m.id = wop.milestone_id
      WHERE wop.work_order_id = ? ORDER BY wop.seq, wop.id`,
    [fromWorkOrderId]
  );
  if (!steps.length) return NextResponse.json({ error: 'That Work Order has no route steps to save' }, { status: 400 });

  const { lastId: templateId } = await execute(
    'INSERT INTO work_order_route_templates (name, series, description, created_by) VALUES (?, ?, ?, ?)',
    [name, String(b.series || '').trim() || null, String(b.description || '').trim() || null, user.username]
  );
  for (const s of steps) {
    await execute(
      `INSERT INTO work_order_route_template_items
         (template_id, seq, operation_id, workstation_id, milestone_key, department, planned_minutes, quality_checkpoint)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [templateId, s.seq, s.operation_id, s.workstation_id, s.milestone_key, s.department, s.planned_minutes, s.quality_checkpoint]
    );
  }
  await audit('work_order_route_template_saved', { actor: user.username, detail: `${name} · ${steps.length} step(s)` });
  return NextResponse.json({ id: Number(templateId) });
}
