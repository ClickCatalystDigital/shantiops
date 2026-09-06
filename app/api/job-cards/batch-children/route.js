// Multi-unit BOM split, Phase 5 (MULTI-UNIT-SPLIT-DESIGN.md §4 Production) — batch action: pick
// several child units + one milestone_key (e.g. "shell_welding"), one job card creation happens
// per child, each resolved to THAT child's own instance of the milestone (every child carries the
// full, unchanged milestone template, §Phase 2 — same milestone_key, different milestone_id per
// child). Per the guiding principle: the batch is a UI convenience, the result is N separate,
// individually-attributable job_cards rows — never one merged record. Reuses the exact insert shape
// POST /api/job-cards already uses, just looped once per resolved child milestone.
//
// Gap-review fix (architecture review, multi-unit split): when the batch carries a bom_item_id,
// re-derive readiness against the routing board — the sibling Dispatch route
// (app/api/packing/batch-children/route.js) already gates on getChildRoutingBoard()'s
// ready/routed_to, this route never did, so a job card could be created for a child whose material
// Stores never allocated or routed to Production at all. A milestone-only batch (no bom_item_id) has
// no board cell to check against and is completely unaffected.
import { NextResponse } from 'next/server';
import { execute, queryOne, queryAll, nextNumber } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { getChildRoutingBoard } from '@/lib/data';
import { audit } from '@/lib/usb';

export async function POST(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Production');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Production', 'production.jobcard.create');
  if (actionDenied) return actionDenied;

  const b = await req.json();
  const milestoneKey = String(b.milestone_key || '').trim();
  const childIds = Array.isArray(b.child_project_ids) ? b.child_project_ids.map(Number).filter(Boolean) : [];
  if (!milestoneKey) return NextResponse.json({ error: 'Milestone is required' }, { status: 400 });
  if (!childIds.length) return NextResponse.json({ error: 'Pick at least one unit' }, { status: 400 });

  const placeholders = childIds.map(() => '?').join(',');
  let milestones = await queryAll(
    `SELECT id, project_id, milestone_label FROM milestones
      WHERE milestone_key = ? AND department = 'Production' AND project_id IN (${placeholders})`,
    [milestoneKey, ...childIds]);
  if (!milestones.length) {
    return NextResponse.json({ error: 'No matching Production milestone found on the selected units' }, { status: 404 });
  }

  // Phase F — informational BOM-revision stamp. Every child shares one master, so one lookup covers
  // the whole batch.
  const master = await queryOne(
    `SELECT m.id AS master_id, m.bom_release_revision FROM projects c JOIN projects m ON m.id = c.master_project_id WHERE c.id = ? LIMIT 1`,
    [milestones[0].project_id]);
  const revision = master?.bom_release_revision ?? null;

  // Only gate on the routing board when this card is tied to real material — a milestone-only card
  // (no bom_item_id) has no allocation/routing concept to check.
  const skipped = [];
  const bomItemId = b.bom_item_id ? Number(b.bom_item_id) : null;
  if (bomItemId && master?.master_id) {
    const board = await getChildRoutingBoard(master.master_id);
    const readyChildIds = new Set(
      board.cells
        .filter(c => c.bom_item_id === bomItemId && c.ready && c.routed_to === 'production')
        .map(c => c.child_project_id));
    const gated = milestones.filter(m => readyChildIds.has(m.project_id));
    for (const m of milestones) if (!readyChildIds.has(m.project_id)) skipped.push(m.project_id);
    milestones = gated;
  }

  const created = [];
  for (const m of milestones) {
    const jcNo = await nextNumber('jc_no', 'JC');
    const { lastId } = await execute(
      `INSERT INTO job_cards
         (project_id, milestone_id, section, bom_item_id, operation_id, workstation_id, qty_planned,
          planned_start, planned_end, is_site, notes, created_by, jc_no, bom_release_revision_at_creation)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        m.project_id, m.id, m.milestone_label,
        b.bom_item_id ? Number(b.bom_item_id) : null, b.operation_id ? Number(b.operation_id) : null,
        b.workstation_id ? Number(b.workstation_id) : null, Number(b.qty_planned) || 0,
        b.planned_start || null, b.planned_end || null, b.is_site ? 1 : 0,
        String(b.notes || '').trim() || null, user.username, jcNo, revision,
      ]);
    created.push({ child_project_id: m.project_id, id: Number(lastId), jc_no: jcNo });
  }
  await audit('job_card_batch_created', {
    actor: user.username,
    detail: `${created.length} job cards for ${milestoneKey} across ${created.length} units${skipped.length ? ` (${skipped.length} skipped — not allocated/routed to Production)` : ''}`,
  });
  return NextResponse.json({ ok: true, created, skipped });
}
