// lib/drawing-approval.mjs — Project View redesign, Part 0-H. The canonical Drawings card's 3-state
// indicator logic: internal approval (always meaningful), customer approval (conditional — blank,
// not a dash, when not applicable). Verified directly against calc_drawings' real schema before
// writing this: `revision` is a single free-text field with no revision-history table and zero
// route/component logic treating it specially — a drawing is one row, these are plain attributes of
// that row, no cross-revision inheritance question exists to answer.
//   node lib/drawing-approval-selfcheck.mjs
const APPROVED_STATUSES = new Set(['approved', 'as_built']);

export function drawingApprovalState(drawing) {
  const internal = APPROVED_STATUSES.has(drawing.status) ? 'approved' : 'not-approved';
  const customerApplicable = !!drawing.customer_visible;
  const customer = customerApplicable
    ? (drawing.customer_approved_at ? 'approved' : 'not-approved')
    : null; // not applicable — the card renders nothing here, never a dash
  return { internal, customerApplicable, customer };
}
