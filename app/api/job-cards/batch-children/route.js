// Multi-unit BOM split, Phase 5 (MULTI-UNIT-SPLIT-DESIGN.md §4 Production) — batch action: pick
// several child units + one milestone_key (e.g. "shell_welding"), one job card creation happens
// per child, each resolved to THAT child's own instance of the milestone (every child carries the
// full, unchanged milestone template, §Phase 2 — same milestone_key, different milestone_id per
// child). Per the guiding principle: the batch is a UI convenience, the result is N separate,
// individually-attributable job_cards rows — never one merged record. Reuses the exact insert shape
// POST /api/job-cards already uses, just looped once per resolved child milestone.
import { NextResponse } from 'next/server';
import { execute, queryAll, nextNumber } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
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
  const milestones = await queryAll(
    `SELECT id, project_id, milestone_label FROM milestones
      WHERE milestone_key = ? AND department = 'Production' AND project_id IN (${placeholders})`,
    [milestoneKey, ...childIds]);
  if (!milestones.length) {
    return NextResponse.json({ error: 'No matching Production milestone found on the selected units' }, { status: 404 });
  }

  const created = [];
  for (const m of milestones) {
    const jcNo = await nextNumber('jc_no', 'JC');
    const { lastId } = await execute(
      `INSERT INTO job_cards
         (project_id, milestone_id, section, bom_item_id, operation_id, workstation_id, qty_planned,
          planned_start, planned_end, is_site, notes, created_by, jc_no)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        m.project_id, m.id, m.milestone_label,
        b.bom_item_id ? Number(b.bom_item_id) : null, b.operation_id ? Number(b.operation_id) : null,
        b.workstation_id ? Number(b.workstation_id) : null, Number(b.qty_planned) || 0,
        b.planned_start || null, b.planned_end || null, b.is_site ? 1 : 0,
        String(b.notes || '').trim() || null, user.username, jcNo,
      ]);
    created.push({ child_project_id: m.project_id, id: Number(lastId), jc_no: jcNo });
  }
  await audit('job_card_batch_created', {
    actor: user.username, detail: `${created.length} job cards for ${milestoneKey} across ${created.length} units`,
  });
  return NextResponse.json({ ok: true, created });
}
