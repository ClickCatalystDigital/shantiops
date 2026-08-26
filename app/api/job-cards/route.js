// The shop-floor execution unit (PRODUCTION-MODULE-DESIGN.md §3.1). List/create, Production + PM.
// Scoped to a real Production milestone (lib/milestones.js) — project_id/section are derived
// server-side from the milestone, not taken from the client, so they can never drift out of sync.
import { NextResponse } from 'next/server';
import { execute, queryOne, nextNumber } from '@/lib/db';
import { getFreshSessionUser, requireDepartment, canAccessDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { getJobCards } from '@/lib/data';
import { audit } from '@/lib/usb';

export async function GET(req) {
  const user = await getFreshSessionUser();
  // Read access also extends to QC (2026-08-23 hardening pass) — QC needs to see a project's job
  // cards to link an NCR to the one actually on hold when raising it from a failed test, not just
  // from Production's own board. Write access below stays Production-only, unchanged.
  if (!canAccessDepartment(user, 'Production') && !canAccessDepartment(user, 'QC')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const params = new URL(req.url).searchParams;
  const projectId = params.get('project_id');
  const status = params.get('status');
  const workOrderId = params.get('work_order_id');
  return NextResponse.json(await getJobCards({ projectId, status, workOrderId }));
}

export async function POST(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Production');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Production', 'production.jobcard.create');
  if (actionDenied) return actionDenied;

  const b = await req.json();
  const milestoneId = Number(b.milestone_id);
  if (!milestoneId) return NextResponse.json({ error: 'Milestone is required' }, { status: 400 });

  const milestone = await queryOne(
    'SELECT id, project_id, milestone_label, department FROM milestones WHERE id = ?', [milestoneId]
  );
  if (!milestone) return NextResponse.json({ error: 'Milestone not found' }, { status: 404 });
  if (milestone.department !== 'Production') {
    return NextResponse.json({ error: 'Job cards can only be raised against a Production milestone' }, { status: 400 });
  }

  const jcNo = await nextNumber('jc_no', 'JC');
  const { lastId } = await execute(
    `INSERT INTO job_cards
       (project_id, milestone_id, section, bom_item_id, operation_id, workstation_id, qty_planned,
        planned_start, planned_end, is_outside, outside_vendor, is_site, rework_of_job_card_id,
        qc_record_id, notes, created_by, jc_no)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      milestone.project_id, milestoneId, milestone.milestone_label,
      b.bom_item_id ? Number(b.bom_item_id) : null, b.operation_id ? Number(b.operation_id) : null,
      b.workstation_id ? Number(b.workstation_id) : null, Number(b.qty_planned) || 0,
      b.planned_start || null, b.planned_end || null, b.is_outside ? 1 : 0,
      b.is_outside ? (String(b.outside_vendor || '').trim() || null) : null, b.is_site ? 1 : 0,
      b.rework_of_job_card_id ? Number(b.rework_of_job_card_id) : null,
      b.qc_record_id ? Number(b.qc_record_id) : null,
      String(b.notes || '').trim() || null, user.username, jcNo,
    ]
  );
  await audit('job_card_created', { actor: user.username, detail: `${jcNo} · ${milestone.milestone_label}` });
  return NextResponse.json({ id: Number(lastId), jc_no: jcNo });
}
