// lib/department-state.mjs — Project View redesign, Part 2. Pure decision logic behind the unified
// Project View's Dynamic Department card: given already-fetched rows, which department(s) have
// real, live operational work on this project right now. lib/data.js's getDepartmentState() does
// the actual queries and calls these; kept separate (same precedent as lib/bom-structure.mjs,
// lib/dependency.mjs, lib/qc-inspections.mjs) so the decision logic itself is runnable and
// checkable under plain node, without a live DB connection.
//   node lib/department-state-selfcheck.mjs
import { derivePurchaseStage, isClosedStatus } from './bom-fields.mjs';

// Design/Installation — the two departments confirmed to have no better operational signal than
// their own milestone status (neither owns a synced milestone with a live-data trigger).
export function milestoneDepartmentEntry(milestones, department) {
  const active = milestones.filter(m => m.department === department && ['in_progress', 'blocked'].includes(m.status));
  if (!active.length) return null;
  return { department, trigger: active.map(m => m.milestone_label).join(', '), fraction: null };
}

// Procurement — the same weakest-link stage read lib/milestone-auto.js's syncProcurementMilestones()
// itself uses, reused directly rather than re-derived.
export function procurementEntry(bomItems) {
  if (!bomItems.length) return null;
  const stages = bomItems.map(it => derivePurchaseStage(it));
  const openCount = stages.filter(s => !isClosedStatus(s)).length;
  if (!openCount) return null;
  return {
    department: 'Procurement',
    trigger: `${openCount} of ${bomItems.length} items still in procurement`,
    fraction: `${bomItems.length - openCount}/${bomItems.length}`,
  };
}

// Stores (normal/master project) — "Received/In-Stock but not yet on any non-draft packing list"
// (physically in Stores' hands, not yet handed to Dispatch) plus any pending QC inward-review hold.
// Cancelled items never reach this signal (the caller only counts Received/In-Stock rows), so a
// cancellation can never falsely keep Stores active.
export function storesEntry({ totalBomCount, notPackedCount, pendingInwardCount }) {
  const count = notPackedCount + pendingInwardCount;
  if (!count) return null;
  const trigger = notPackedCount && pendingInwardCount
    ? `${notPackedCount} item(s) received, ${pendingInwardCount} awaiting QC inward review`
    : notPackedCount ? `${notPackedCount} item(s) received, not yet packed`
    : `${pendingInwardCount} item(s) awaiting QC inward review`;
  return { department: 'Stores', trigger, fraction: null };
}

// Stores (split child) — a child owns no bom_items of its own; this reads the per-unit allocation
// view (getChildDerivedBom's items, each carrying `.ready`) instead.
export function childStoresEntry(items) {
  if (!items.length) return null;
  const notReady = items.filter(it => !it.ready);
  if (!notReady.length) return null;
  return {
    department: 'Stores',
    trigger: `${notReady.length} of ${items.length} items not yet fully allocated`,
    fraction: `${items.length - notReady.length}/${items.length}`,
  };
}

// Production — work_orders/job_cards genuinely carry the right project_id for both a normal
// project and a split child (confirmed: the batch job-card route stamps each child's own id).
// Returns both the card entry and the held-job-card count, since QC's own signal needs the count
// too (the same requires_qc_hold row is real, confirmed, code-enforced overlap between the two).
export function productionEntry(workOrders, jobCards) {
  const activeWO = workOrders.filter(w => ['released', 'in_progress'].includes(w.status)).length;
  const activeJC = jobCards.filter(j => j.status === 'progress').length;
  const heldJC = jobCards.filter(j => j.requires_qc_hold && !j.qc_released_at).length;
  let entry = null;
  if (activeWO || activeJC || heldJC) {
    const bits = [];
    if (activeJC) bits.push(`${activeJC} job card(s) in progress`);
    if (heldJC) bits.push(`${heldJC} held for QC`);
    entry = { department: 'Production', trigger: bits.join(', ') || `${activeWO} work order(s) active`, fraction: null };
  }
  return { entry, heldCount: heldJC };
}

// Production, from the real 33-stage Job Card (job_sheet_stages) — the system actually in
// day-to-day use, not job_cards (confirmed zero real rows in live data; kept as dormant fallback
// plumbing below since it still feeds QC's own held-card count for the multi-unit split/NCR
// rework path). Stages: every job_sheet_stage row across the project's own job_sheet(s). No
// hardcoded /33 — a plain count of whatever rows actually exist, correct even as a sheet's own
// stage count diverges from 33 (already possible today). Returns null once every stage is
// qc_signed — nothing currently active to report, same "drops out once done" convention every
// other entry in this file already follows.
export function jobSheetProductionEntry(stages) {
  if (!stages.length) return null;
  const total = stages.length;
  const done = stages.filter(s => s.qc_sign_by).length;
  if (done === total) return null;
  const inProgress = stages.filter(s => s.start_date && !s.end_date).length;
  const waiting = stages.filter(s => s.end_date && !s.qc_sign_by).length;
  const bits = [];
  if (inProgress) bits.push(`${inProgress} stage(s) in progress`);
  if (waiting) bits.push(`${waiting} awaiting QC sign-off`);
  return { department: 'Production', trigger: bits.join(', ') || `${done}/${total} stages complete`, fraction: `${done}/${total}` };
}

// QC — qc_records/ncr_records genuinely carry this project's own id even for a split child (QC
// documents/records are created per-unit); pendingInwardCount is 0 for a child by construction of
// the caller (inward_approvals is master-scoped for split material — the child branch already
// surfaces that signal under Stores instead, so it's never double-counted here).
//
// checkpoint: the real statutory-document model (milestone-automation plan §C) — {completeCount,
// totalCount} summed across every qc_documents row for the project, or undefined if the project has
// none yet. Shown as a real fraction alongside the existing operational trigger text (pending
// tests/NCRs/holds) — deliberately additive, not a replacement: a document's Form 2/3/3A/4A/
// Bought-out completeness and "is there an open NCR right now" are different facts, both worth
// showing. A raw sum-of-counts across heterogeneous checkpoint types is honest as "how much of the
// paperwork is cleared," not as a percentage claiming every checkpoint carries equal weight.
export function qcEntry({ qcPendingCount, openNcrCount, pendingInwardCount, heldJobCardCount, checkpoint }) {
  const hasCheckpoint = checkpoint && checkpoint.totalCount > 0;
  const total = qcPendingCount + openNcrCount + pendingInwardCount + heldJobCardCount;
  if (!total && !hasCheckpoint) return null;
  const bits = [];
  if (qcPendingCount) bits.push(`${qcPendingCount} pending test(s)`);
  if (openNcrCount) bits.push(`${openNcrCount} open NCR(s)`);
  if (heldJobCardCount) bits.push(`${heldJobCardCount} job card(s) on hold`);
  if (hasCheckpoint && checkpoint.completeCount < checkpoint.totalCount) {
    bits.push(`${checkpoint.completeCount}/${checkpoint.totalCount} statutory checkpoints complete`);
  }
  return {
    department: 'QC',
    trigger: bits.join(', ') || 'statutory documentation complete',
    fraction: hasCheckpoint ? `${checkpoint.completeCount}/${checkpoint.totalCount}` : null,
  };
}

// Dispatch — packing_lists/pre_dispatch_approvals, never the `packing` milestone's own stored
// status (confirmed to diverge both too-early and stale-forever-after: a milestone marked done the
// instant any one list ships, never reopened when more packable material appears later).
//
// checkpoint: {completeCount, totalCount, listCount} from getDispatchCheckpointSummaries (§D's 4
// built checkpoints — Production approval, QC approval, Dispatched, Received — summed across every
// packing list for the project), or undefined if there are none yet. Additive to the existing
// operational trigger text, same reasoning as qcEntry's own checkpoint field.
export function dispatchEntry(packingLists, latestApprovalCycles, checkpoint) {
  const activePacking = packingLists.filter(l => ['draft', 'packed'].includes(l.status)).length;
  const pendingCycles = latestApprovalCycles.filter(a => a.status === 'pending').length;
  const hasCheckpoint = checkpoint && checkpoint.totalCount > 0;
  if (!activePacking && !pendingCycles && !hasCheckpoint) return null;
  const bits = [];
  if (activePacking) bits.push(`${activePacking} packing list(s) in progress`);
  if (pendingCycles) bits.push(`${pendingCycles} awaiting pre-dispatch approval`);
  if (hasCheckpoint) bits.push(`${checkpoint.completeCount}/${checkpoint.totalCount} dispatch checkpoints complete`);
  return {
    department: 'Dispatch',
    trigger: bits.join(', ') || 'dispatch complete',
    fraction: hasCheckpoint ? `${checkpoint.completeCount}/${checkpoint.totalCount}` : null,
  };
}
