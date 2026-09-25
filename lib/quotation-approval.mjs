// lib/quotation-approval.mjs — Sales CRM plan 4. A quotation whose biggest line discount is above
// the Sales Head's threshold needs a Head's approval before it can be sent, accepted or converted.
// Revisions keep one chain: the first quotation is R0, then "<first no>-R1", "-R2" … Pure.

export const DEFAULT_DISCOUNT_APPROVAL_PCT = 10;

export function maxDiscount(items = []) {
  return items.reduce((m, it) => Math.max(m, Number(it.discount_pct) || 0), 0);
}

// 'pending' when the discount is above the threshold, else null (no approval needed).
export function approvalFor(items, thresholdPct) {
  const t = Number(thresholdPct);
  const limit = Number.isFinite(t) && t >= 0 ? t : DEFAULT_DISCOUNT_APPROVAL_PCT;
  return maxDiscount(items) > limit ? 'pending' : null;
}

// Statuses a pending quotation can't move to until a Head approves.
export const BLOCKED_WHILE_PENDING = ['sent', 'accepted'];
export function blockedByApproval(q, toStatus) {
  return q?.approval_status === 'pending' && BLOCKED_WHILE_PENDING.includes(toStatus);
}

export function revisionNumber(rootNo, n) {
  return `${rootNo}-R${n}`;
}
