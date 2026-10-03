// Customer-portal stage status for Manufacturing, Quality Testing and Documentation, read from the
// real work: job card stages (production finishes a stage, QC signs it) and QC statutory documents.
// The DISPATCH stage is left out — it is the hand-over to Dispatch, which the Packing stage covers.
// Returns null when there is nothing to read (no job card yet) so the caller keeps the older
// milestone-based status for those projects.
import { isDispatchStage } from './job-sheet-stages.mjs';

export function stageProgress(rows) {
  const r = rows.filter(x => !isDispatchStage(x.name));
  return {
    total: r.length,
    started: r.filter(x => x.start_date || x.end_date || x.qc_sign_by).length,
    finished: r.filter(x => x.end_date || x.qc_sign_by).length,
    signed: r.filter(x => x.qc_sign_by).length,
  };
}

// docs: [{ total_parts, linked_parts, customer_visible }] — a document counts once every part has its
// certificate and QC has shared it with the customer.
export const docDone = d => Number(d.total_parts) > 0 && Number(d.linked_parts) === Number(d.total_parts) && !!d.customer_visible;

export function phaseFromWork(key, sp, docs) {
  if (key === 'manufacturing' && sp.total) {
    const status = sp.finished === sp.total ? 'done' : sp.started > 0 ? 'in_progress' : 'upcoming';
    return { status, progress: { done: sp.finished, total: sp.total, noun: 'stages' } };
  }
  if (key === 'testing' && sp.total) {
    const status = sp.signed === sp.total ? 'done' : sp.finished > 0 ? 'in_progress' : 'upcoming';
    return { status, progress: { done: sp.signed, total: sp.total, noun: 'stages signed off' } };
  }
  if (key === 'documentation') {
    const done = docs.filter(docDone).length;
    const status = docs.length && done === docs.length ? 'done' : docs.length ? 'in_progress' : 'upcoming';
    return { status, progress: { done, total: docs.length, noun: 'documents' } };
  }
  return null;
}
