// lib/lost-reasons.mjs — the fixed reason list for Order Lost, so the Lost Reasons report can count
// them. Stored in leads.lost_reason as "<Reason>" or "<Reason> — <details>". Older free-text reasons
// have no known prefix and are counted as "Other (free text)".
export const LOST_REASONS = ['Price too high', 'Lost to competitor', 'Customer postponed', 'Requirement changed', 'No response', 'Delivery time too long', 'Other'];

export const composeReason = (reason, details) => (details?.trim() ? `${reason} — ${details.trim()}` : reason);

export function reasonCategory(stored) {
  const head = String(stored || '').split(' — ')[0].trim();
  return LOST_REASONS.includes(head) ? head : 'Other (free text)';
}
