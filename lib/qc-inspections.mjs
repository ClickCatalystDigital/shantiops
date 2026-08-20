// lib/qc-inspections.mjs — pure logic behind STERP items 33-35 (§5p): Job-Work Inspection variance
// and Calibration due/expired status. Pulled out of lib/data.js so it's independently testable
// (mirrors lib/bom-structure.mjs's precedent).

// Variance = sent - received, computed live (never stored). null when either side is unknown —
// don't fabricate a variance from a missing number.
export function jobWorkVariance(sentQty, receivedQty) {
  if (sentQty == null || receivedQty == null) return null;
  return sentQty - receivedQty;
}

// blocked (manual override) always wins over the date. No due_date at all reads as ok — nothing to
// be overdue against. today/soon are ISO date strings (YYYY-MM-DD) so plain string comparison works.
export function calibrationStatus({ due_date, blocked }, today, soon) {
  if (blocked) return 'blocked';
  if (!due_date) return 'ok';
  if (due_date < today) return 'expired';
  if (due_date <= soon) return 'due_soon';
  return 'ok';
}
