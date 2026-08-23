// Generates the execution-level Job Cards (§5g) for a released Work Order — one per route-card
// step that doesn't already have one, so this is safe to call again after adding a step later.
// Each card carries work_order_id/work_order_operation_id (new job_cards columns) plus the step's
// own milestone_id (when the route step was mapped to one) so existing milestone automation
// (lib/milestone-auto.js) keeps working for against_order Work Orders exactly as it does for
// hand-created cards.
import { NextResponse } from 'next/server';
import { execute, queryAll, queryOne } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { audit } from '@/lib/usb';

export async function POST(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Production');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Production', 'production.jobcard.create');
  if (actionDenied) return actionDenied;

  const wo = await queryOne('SELECT id, project_id, status, qty_planned FROM work_orders WHERE id = ?', [params.id]);
  if (!wo) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!['released', 'in_progress'].includes(wo.status)) {
    return NextResponse.json({ error: 'Work Order must be released before generating Job Cards' }, { status: 400 });
  }

  const ops = await queryAll(
    `SELECT wop.*, o.name AS operation_name FROM work_order_operations wop
       LEFT JOIN operations o ON o.id = wop.operation_id
      WHERE wop.work_order_id = ?
        AND NOT EXISTS (SELECT 1 FROM job_cards WHERE work_order_operation_id = wop.id)
      ORDER BY wop.seq, wop.id`,
    [params.id]
  );
  if (!ops.length) return NextResponse.json({ created: 0 });

  let created = 0;
  for (const op of ops) {
    const section = op.department || op.operation_name || `Work Order route step #${op.seq}`;
    // Hold-point gate (plan §5d) — a route step that already names a QC checkpoint IS a hold point,
    // no separate ITP document type needed.
    await execute(
      `INSERT INTO job_cards
         (project_id, milestone_id, section, operation_id, workstation_id, qty_planned, work_order_id,
          work_order_operation_id, requires_qc_hold, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [wo.project_id, op.milestone_id, section, op.operation_id, op.workstation_id, wo.qty_planned,
        wo.id, op.id, op.quality_checkpoint ? 1 : 0, user.username]
    );
    created++;
  }
  await audit('work_order_job_cards_generated', { actor: user.username, detail: `WO #${params.id} · ${created} card(s)` });
  return NextResponse.json({ created });
}
