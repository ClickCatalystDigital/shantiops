// lib/milestone-auto.js — automatic milestone completion, triggered by the real actions that
// actually finish a milestone's work, instead of relying purely on a human remembering to open the
// milestone drawer and mark it done by hand. Each sync function is called from the API route that
// owns the underlying event (job card status, QC result, packing status, BOM purchase_status,
// drawing customer-approval) — never polled, always event-driven. Every function is a no-op unless
// its own condition is actually met, and markMilestoneDone only ever moves a milestone pending ->
// done (never reopens one), same one-way semantics the manual PATCH route already has.
import { execute, queryOne, queryAll } from './db';
import { todayISO } from './date';
import { fireHandoff, notifyDepartment, notifyPMs } from './notify';
import { derivePurchaseStage } from './bom-fields.mjs';

// Marks one project's milestone done if it isn't already — shared by every sync function below.
// Mirrors app/api/milestones/[id]/route.js's own done-transition (actual_end auto-stamped, handoff
// fired once, best-effort). `actor` is cosmetic (audit/notification only); there is no user-facing
// audit call here since these are system-triggered, not a user-initiated edit.
export async function markMilestoneDone(projectId, milestoneKey, actor = 'system') {
  const m = await queryOne(
    'SELECT id, status, actual_end FROM milestones WHERE project_id = ? AND milestone_key = ?',
    [projectId, milestoneKey]
  );
  if (!m || m.actual_end || m.status === 'done') return;
  await execute(
    `UPDATE milestones SET status = 'done', actual_end = COALESCE(actual_end, ?), updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [todayISO(), m.id]
  );
  try { await fireHandoff(m.id, actor); } catch { /* best-effort, same precedent as the manual route */ }
  try { await notifyMilestoneExtra(projectId, milestoneKey); } catch { /* best-effort */ }
}

// A couple of milestones need a notification beyond fireHandoff's normal next-department relay:
// - procurement_procured has no department-relevant link to QC in the handoff chain (its next
//   milestone is Production's marking_cutting), but QC wants to know once every BOM item on a
//   project has cleared procurement so they can start preparing inspection records.
// - commissioning is the last row in MILESTONE_TEMPLATE, so handoffTarget() returns null and
//   fireHandoff is a no-op — Sales/PMs get notified at project creation but never at completion.
// Exported: commissioning has no auto-detect signal (no site-visit log, no commissioning record),
// so it only ever completes via the manual PATCH route (app/api/milestones/[id]/route.js), never
// through markMilestoneDone above — that route calls this directly alongside its own fireHandoff.
export async function notifyMilestoneExtra(projectId, milestoneKey) {
  if (milestoneKey !== 'procurement_procured' && milestoneKey !== 'commissioning') return;
  const project = await queryOne('SELECT project_no FROM projects WHERE id = ?', [projectId]);
  if (milestoneKey === 'procurement_procured') {
    await notifyDepartment('QC', {
      kind: 'procurement_procured',
      title: 'All items procured',
      body: `${project?.project_no || ''} · ready for QC to prepare inspection records`,
      dedupe_key: `procurement_procured:${projectId}`,
    });
  } else {
    const note = {
      kind: 'project_complete',
      title: 'Project complete',
      body: `${project?.project_no || ''} · commissioning done`,
      dedupe_key: `commissioning:${projectId}`,
    };
    await notifyDepartment('Sales', note);
    await notifyPMs(note);
  }
}

// Production's 12 milestones (marking_cutting .. painting) — a job card already carries the
// milestone it's fabricating for (job_cards.milestone_id). Once every job card raised against a
// given milestone reaches 'done', that milestone's own work is actually finished. No cards yet
// raised means nothing to conclude from (stays pending), not "trivially done".
export async function syncProductionMilestoneById(milestoneId, actor = 'system') {
  if (!milestoneId) return;
  const cards = await queryAll('SELECT status FROM job_cards WHERE milestone_id = ?', [milestoneId]);
  if (!cards.length || !cards.every(c => c.status === 'done')) return;
  const m = await queryOne('SELECT project_id, status, actual_end FROM milestones WHERE id = ?', [milestoneId]);
  if (!m || m.actual_end || m.status === 'done') return;
  await execute(
    `UPDATE milestones SET status = 'done', actual_end = COALESCE(actual_end, ?), updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [todayISO(), milestoneId]
  );
  try { await fireHandoff(milestoneId, actor); } catch { /* best-effort */ }
}

// Hydro Test — Production's own test record (qc_records, test_type matching /hydro/i, same
// regex precedent DepartmentPanel.jsx/app/api/qc-records already use to split hydro from QC's other
// test types) reaching a passing result is the real completion signal.
export async function syncHydroTestMilestone(projectId, actor = 'system') {
  const recs = await queryAll('SELECT test_type, result FROM qc_records WHERE project_id = ?', [projectId]);
  if (!recs.some(r => /hydro/i.test(r.test_type) && r.result === 'pass')) return;
  await markMilestoneDone(projectId, 'hydro_test', actor);
}

// Packing — Dispatch's own packing_lists.status reaching 'packed' or 'dispatched' (anything past
// 'draft') is the real completion signal for the 'packing' milestone.
export async function syncPackingMilestone(projectId, actor = 'system') {
  if (!projectId) return;
  const pl = await queryOne(
    `SELECT id FROM packing_lists WHERE project_id = ? AND status IN ('packed', 'dispatched') LIMIT 1`,
    [projectId]
  );
  if (!pl) return;
  await markMilestoneDone(projectId, 'packing', actor);
}

// Design Approval = the customer approving the design, aggregated from the per-drawing approval
// that already exists (calc_drawings.customer_approved_at, app/api/calc-drawings/[id]/approve) —
// no separate "approve the whole design" action exists, so this is that action's project-level
// rollup: every customer-visible drawing on the project has to be customer-approved. Needs at least
// one such drawing to conclude anything (an empty set is not "all approved").
export async function syncDesignApprovalMilestone(projectId, actor = 'system') {
  const drawings = await queryAll(
    'SELECT customer_approved_at FROM calc_drawings WHERE project_id = ? AND customer_visible = 1',
    [projectId]
  );
  if (!drawings.length || !drawings.every(d => d.customer_approved_at)) return;
  await markMilestoneDone(projectId, 'design_approval', actor);
}

// Procurement's 5 milestones (Enquiry/Comparison/Ordered/Transit/Procured) map onto the same 5
// purchase_status stages every BOM item already moves through (lib/bom-fields.mjs's
// derivePurchaseStage/ACTIVE_STAGES) — not a separate per-material-category taxonomy nothing else
// in the app tracks. "All items must clear the stage": a stage milestone completes only once every
// BOM item on the project has moved at least that far along, the same weakest-link logic the
// existing 5-segment BomStageBar already visualizes per item. Cancelled/In-Stock count as fully
// cleared (terminal, out of the flow), same as Received.
const PROC_STAGE_INDEX = { Enquiry: 0, Comparison: 1, Ordered: 2, Transit: 3, Received: 4, Cancelled: 4, 'In-Stock': 4 };
// [milestone_key, minimum stage index every item must have reached for this milestone to be done]
const PROCUREMENT_MILESTONES = [
  ['procurement_enquiry', 1], ['procurement_comparison', 2], ['procurement_ordered', 3],
  ['procurement_transit', 4], ['procurement_procured', 4],
];
export async function syncProcurementMilestones(projectId, actor = 'system') {
  const items = await queryAll(
    `SELECT b.purchase_status, b.selected_quote_id, b.po_ref,
            (SELECT COUNT(*) FROM supplier_quotes sq WHERE sq.bom_item_id = b.id) AS quote_count
       FROM bom_items b WHERE b.project_id = ?`,
    [projectId]
  );
  if (!items.length) return; // no BOM yet — nothing for Procurement to have started
  const minIndex = Math.min(...items.map(it => PROC_STAGE_INDEX[derivePurchaseStage(it)] ?? 0));
  for (const [key, threshold] of PROCUREMENT_MILESTONES) {
    if (minIndex >= threshold) await markMilestoneDone(projectId, key, actor);
  }
}
