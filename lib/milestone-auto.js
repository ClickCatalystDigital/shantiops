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
import { MILESTONE_TEMPLATE } from './milestones';

// Settings' Milestone Automation card — one row per milestone key that has real automation below
// (design_approval/release_drawings each have both a start and a complete function; the 5
// procurement keys share one ladder; the 13 Production keys collapse into one representative row,
// marking_cutting, since they always complete/start together; packing has both). Every other
// milestone (design, release_bom, site_installation, commissioning) has no automation at all and so
// gets no row here — there's nothing for a toggle to gate.
export const MILESTONE_AUTOMATION_CATALOG = [
  { key: 'release_drawings', label: 'Release All Drawings', department: 'Design' },
  { key: 'design_approval', label: 'Design Approval', department: 'Design' },
  { key: 'procurement_enquiry', label: 'Procurement — Enquiry', department: 'Procurement' },
  { key: 'procurement_comparison', label: 'Procurement — Comparison', department: 'Procurement' },
  { key: 'procurement_ordered', label: 'Procurement — Ordered', department: 'Procurement' },
  { key: 'procurement_transit', label: 'Procurement — Transit', department: 'Procurement' },
  { key: 'procurement_procured', label: 'Procurement — Procured', department: 'Procurement' },
  { key: 'marking_cutting', label: 'Production (from Job Card stages)', department: 'Production' },
  { key: 'packing', label: 'Packing & Labeling', department: 'Dispatch' },
];

// Admin-editable business rules (Settings -> Milestone Automation) — one row per milestone key that
// has real automation, auto_start/auto_complete independently toggleable. No row = both enabled
// (today's behavior, unchanged), same "no row = default open" precedent as action_permissions. A
// plain queryOne every call, no caching — matches how every other small config read in this
// codebase (e.g. getAllocationMode) already works, nothing here is hot enough to need one.
export async function isMilestoneAutomationEnabled(milestoneKey, kind) {
  const row = await queryOne(
    'SELECT auto_start, auto_complete FROM milestone_automation WHERE milestone_key = ?',
    [milestoneKey]
  );
  const val = kind === 'start' ? row?.auto_start : row?.auto_complete;
  return val == null || val !== 0;
}

// The shared "flip pending -> in_progress" helper every auto-start hook below calls. Mirrors
// markMilestoneDone's own guard shape: only ever acts on a milestone that is still at its untouched
// default (status='pending', no actual_start yet) — a milestone a human already started, blocked, or
// closed is never touched. Idempotent: safe to call more than once for the same real-world event.
export async function maybeStartMilestone(projectId, milestoneKey, actor = 'system') {
  if (!projectId || !milestoneKey) return;
  if (!(await isMilestoneAutomationEnabled(milestoneKey, 'start'))) return;
  const m = await queryOne(
    'SELECT id, status, actual_start FROM milestones WHERE project_id = ? AND milestone_key = ?',
    [projectId, milestoneKey]
  );
  if (!m || m.actual_start || m.status !== 'pending') return;
  await execute(
    `UPDATE milestones SET status = 'in_progress', actual_start = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [todayISO(), m.id]
  );
}

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
  if (!(await isMilestoneAutomationEnabled('packing', 'complete'))) return;
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
  if (!(await isMilestoneAutomationEnabled('design_approval', 'complete'))) return;
  const drawings = await queryAll(
    'SELECT customer_approved_at FROM calc_drawings WHERE project_id = ? AND customer_visible = 1',
    [projectId]
  );
  if (!drawings.length || !drawings.every(d => d.customer_approved_at)) return;
  await markMilestoneDone(projectId, 'design_approval', actor);
}

// Release All Drawings — Design Head's own internal sign-off (calc_drawings.status reaching
// 'approved'/'as_built', a Head-only gated action, distinct from customer approval above and
// confirmed real/already happening in live data unlike the customer-approval path). "Required
// scope" is the same honest denominator the existing DrawingProgressBar UI already uses — however
// many calc_drawings rows currently exist for the project, since nothing creates one speculatively.
// Needs at least one drawing to conclude anything (an empty set is not "all approved").
export async function syncReleaseDrawingsMilestone(projectId, actor = 'system') {
  if (!(await isMilestoneAutomationEnabled('release_drawings', 'complete'))) return;
  const drawings = await queryAll('SELECT status FROM calc_drawings WHERE project_id = ?', [projectId]);
  if (!drawings.length || !drawings.every(d => ['approved', 'as_built'].includes(d.status))) return;
  await markMilestoneDone(projectId, 'release_drawings', actor);
}

// The 12 Production-department milestone keys this batch is allowed to complete — deliberately
// EXCLUDES hydro_test. A job-sheet "qc" sign action (app/api/job-sheets/[id]/stages/[stageId]/
// route.js) is a plain inspection/paperwork record with no pass/fail field at all — "a record only,
// nothing is blocked by it." Marking the statutory Hydro Test milestone done off that signal would
// mean a real IBR-regulated pressure vessel's hydro test could be recorded complete without ever
// confirming a real passing qc_records row exists (a genuine compliance-integrity gap, caught in
// review before shipping). hydro_test stays exclusively driven by syncHydroTestMilestone below,
// which requires a real qc_records row with result='pass' — completely unaffected by this batch.
const PRODUCTION_JOBSHEET_KEYS = MILESTONE_TEMPLATE
  .filter(m => m.department === 'Production' && m.key !== 'hydro_test')
  .map(m => m.key);

// Production, from the real 33-stage Job Card (job_sheets/job_sheet_stages) — the system actually in
// day-to-day use, not the legacy job_cards table (confirmed zero rows in live data). The 33 stages do
// not cleanly map to the 12 milestone keys (confirmed: no forced mapping), so they collapse into one
// Production phase for automation: every stage across the project's job_sheet(s) reaching qc_signed
// marks all 12 keys done together (hydro_test excluded — see above).
// Never a hardcoded /33 — a plain COUNT of whatever rows actually exist, correct even if a sheet's
// own stage count ever diverges from 33 (already possible today via the stage add/delete routes).
export async function syncProductionFromJobSheets(projectId, actor = 'system') {
  if (!projectId) return;
  if (!(await isMilestoneAutomationEnabled('marking_cutting', 'complete'))) return;
  const row = await queryOne(
    `SELECT COUNT(*) AS total, SUM(CASE WHEN s.qc_sign_by IS NOT NULL THEN 1 ELSE 0 END) AS signed
       FROM job_sheet_stages s JOIN job_sheets js ON js.id = s.sheet_id WHERE js.project_id = ?`,
    [projectId]
  );
  const total = Number(row?.total || 0), signed = Number(row?.signed || 0);
  if (!total || signed < total) return;
  for (const key of PRODUCTION_JOBSHEET_KEYS) await markMilestoneDone(projectId, key, actor);
}

// Production auto-start — "material has physically moved to WIP for this project," confirmed clean
// with three guards: never the sentinel/system project (Stores' routine stock-build issues route
// through it), never a null-resolvable project (a standalone /planning cut is deliberately
// unlinked), and — for the piece-tracked path — only the real shop-floor cut event (cutPiece stamps
// cut_at; a bought-out piece's separate dispatch-time consumption flip never does, and this helper
// is never called from that code path at all). Always starts marking_cutting, the first of the 13
// collapsed keys — which of the 33 real stages happens to start first is not tracked at this level.
export async function maybeStartProductionForProject(projectId, actor = 'system') {
  if (!projectId) return;
  const project = await queryOne('SELECT is_system FROM projects WHERE id = ?', [projectId]);
  if (!project || project.is_system) return;
  await maybeStartMilestone(projectId, 'marking_cutting', actor);
}

// Same guard, resolved from a bom_item — the shape material_issues' own writers have on hand.
export async function maybeStartProductionForBomItem(bomItemId, actor = 'system') {
  if (!bomItemId) return;
  const row = await queryOne('SELECT project_id FROM bom_items WHERE id = ?', [bomItemId]);
  if (row?.project_id) await maybeStartProductionForProject(row.project_id, actor);
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
  // One batched auto_complete lookup for all 5 keys, instead of a separate round-trip per key inside
  // the loop below (this fires on every BOM purchase_status change) — same "no row = enabled"
  // default isMilestoneAutomationEnabled itself already uses.
  const procKeys = PROCUREMENT_MILESTONES.map(([k]) => k);
  const autoRows = await queryAll(
    `SELECT milestone_key, auto_complete FROM milestone_automation WHERE milestone_key IN (${procKeys.map(() => '?').join(',')})`,
    procKeys
  );
  const completeEnabled = new Map(autoRows.map(r => [r.milestone_key, r.auto_complete == null || r.auto_complete !== 0]));
  for (const [key, threshold] of PROCUREMENT_MILESTONES) {
    if (minIndex >= threshold && (completeEnabled.get(key) ?? true)) {
      await markMilestoneDone(projectId, key, actor);
    }
  }
  // Auto-start — any real activity (a logged quote, or a stage past plain Enquiry) starts the first
  // not-yet-done rung of the ladder, one at a time, matching its own visual "you're here" metaphor.
  const hasActivity = minIndex >= 1 || items.some(it => Number(it.quote_count) > 0);
  if (hasActivity) {
    const keys = PROCUREMENT_MILESTONES.map(([k]) => k);
    const msRows = await queryAll(
      `SELECT milestone_key, status FROM milestones WHERE project_id = ? AND milestone_key IN (${keys.map(() => '?').join(',')})`,
      [projectId, ...keys]
    );
    const firstPending = PROCUREMENT_MILESTONES.find(([k]) => msRows.find(m => m.milestone_key === k)?.status !== 'done');
    if (firstPending) await maybeStartMilestone(projectId, firstPending[0], actor);
  }
}
