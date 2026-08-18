// lib/dependency.mjs — v1 dependency/readiness engine. Observational only: computes whether a
// milestone is actually workable right now and why not, alongside the existing human `status`
// (lib/sla.js), never in place of it. Pure, no imports beyond bom-fields.mjs (itself pure) — same
// shape as handoff.mjs, safe for client components and plain `node --test`.
//
// v1 scope deliberately stops at read-only signal: this does not gate writes, replace
// lib/data.js's hand-written release_bom/production_done gates, or feed effectiveStatus()'s
// severity ranking yet. See SYSTEM.md's dependency-engine plan for why (those come once this has
// been observed against real project data).
import { derivePurchaseStage } from './bom-fields.mjs';

const PROC_STAGE_INDEX = { Enquiry: 0, Comparison: 1, Ordered: 2, Transit: 3, Received: 4, Cancelled: 4, 'In-Stock': 4 };

// Milestones where "predecessor is done" isn't a trustworthy enough readiness signal on its own —
// e.g. Production can be handed off release_bom-done work by Design while the actual material is
// still mid-procurement. Reuses the same weakest-link BOM signal lib/milestone-auto.js's
// syncProcurementMilestones already trusts (derivePurchaseStage per item, worst item wins).
// Deliberately a small hardcoded table, not a generic rule language — same precedent as
// PROC_STAGE_INDEX/PROCUREMENT_MILESTONES in lib/milestone-auto.js. Extend it once more cases are
// confirmed, don't generalize ahead of need.
const READINESS_CHECKS = {
  marking_cutting: (bomItems) => {
    if (!bomItems.length) return { ready: true }; // no BOM yet — nothing to block on
    const minIndex = Math.min(...bomItems.map(it => PROC_STAGE_INDEX[derivePurchaseStage(it)] ?? 0));
    if (minIndex >= PROC_STAGE_INDEX.Received) return { ready: true };
    return { ready: false, reason: 'Material not yet received from Procurement', department: 'Procurement' };
  },
};

// One milestone's readiness. `rows` MUST be that project's own milestone rows (never
// MILESTONE_TEMPLATE — depends_on_key/department are per-row and can be hand-edited, same caveat
// nextBySortOrder/handoffTarget already document). `bomItems` — plain rows with purchase_status/
// selected_quote_id/po_ref/quote_count, same shape syncProcurementMilestones queries.
export function milestoneReadiness(m, rows, bomItems = []) {
  if (m.actual_end || m.status === 'done') return { ready: true, blocked_by: null };

  if (m.depends_on_key) {
    const pred = rows.find(r => r.milestone_key === m.depends_on_key);
    if (pred && !(pred.actual_end || pred.status === 'done')) {
      return {
        ready: false,
        blocked_by: { type: 'milestone', key: pred.milestone_key, label: pred.milestone_label, department: pred.department },
      };
    }
  }

  const check = READINESS_CHECKS[m.milestone_key];
  if (check) {
    const result = check(bomItems);
    if (!result.ready) {
      return { ready: false, blocked_by: { type: 'signal', reason: result.reason, department: result.department } };
    }
  }

  return { ready: true, blocked_by: null };
}

// Cross-record consistency flag — a milestone that's already done while its own structural
// predecessor is NOT done. Never blocks or corrects anything (v1 is read-only observational,
// same as blocked_by); just surfaces the anomaly so a PM can look at it. Distinct from
// milestoneReadiness's own done-short-circuit, which deliberately never looks at the predecessor
// once a milestone is done — this is the one place that gap gets checked.
export function outOfOrderFlag(m, rows) {
  const isDone = !!(m.actual_end || m.status === 'done');
  if (!isDone || !m.depends_on_key) return null;
  const pred = rows.find(r => r.milestone_key === m.depends_on_key);
  if (pred && !(pred.actual_end || pred.status === 'done')) {
    return { type: 'milestone', key: pred.milestone_key, label: pred.milestone_label, department: pred.department };
  }
  return null;
}

// Whole-project view — one readiness object per milestone, same order/length as `rows`.
export function projectDependencyStatus(rows, bomItems = []) {
  return rows.map(m => ({
    milestone_id: m.id,
    milestone_key: m.milestone_key,
    ...milestoneReadiness(m, rows, bomItems),
    out_of_order: outOfOrderFlag(m, rows),
  }));
}
