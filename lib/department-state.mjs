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

// QC — qc_records/ncr_records genuinely carry this project's own id even for a split child (QC
// documents/records are created per-unit); pendingInwardCount is 0 for a child by construction of
// the caller (inward_approvals is master-scoped for split material — the child branch already
// surfaces that signal under Stores instead, so it's never double-counted here).
export function qcEntry({ qcPendingCount, openNcrCount, pendingInwardCount, heldJobCardCount }) {
  const total = qcPendingCount + openNcrCount + pendingInwardCount + heldJobCardCount;
  if (!total) return null;
  const bits = [];
  if (qcPendingCount) bits.push(`${qcPendingCount} pending test(s)`);
  if (openNcrCount) bits.push(`${openNcrCount} open NCR(s)`);
  if (heldJobCardCount) bits.push(`${heldJobCardCount} job card(s) on hold`);
  return { department: 'QC', trigger: bits.join(', '), fraction: null };
}

// Dispatch — packing_lists/pre_dispatch_approvals, never the `packing` milestone's own stored
// status (confirmed to diverge both too-early and stale-forever-after: a milestone marked done the
// instant any one list ships, never reopened when more packable material appears later).
export function dispatchEntry(packingLists, latestApprovalCycles) {
  const activePacking = packingLists.filter(l => ['draft', 'packed'].includes(l.status)).length;
  const pendingCycles = latestApprovalCycles.filter(a => a.status === 'pending').length;
  if (!activePacking && !pendingCycles) return null;
  const bits = [];
  if (activePacking) bits.push(`${activePacking} packing list(s) in progress`);
  if (pendingCycles) bits.push(`${pendingCycles} awaiting pre-dispatch approval`);
  return { department: 'Dispatch', trigger: bits.join(', '), fraction: null };
}
