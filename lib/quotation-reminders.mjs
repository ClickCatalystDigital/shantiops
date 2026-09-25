// lib/quotation-reminders.mjs — Sales CRM plan 2d. Pure rule: does a quotation need a follow-up,
// and why? Shared by the reminder sweep (lib/quotation-reminders.js) and the Quotations tab's
// "Needs follow-up" filter so the two can never disagree. Dates are ISO strings (YYYY-MM-DD or
// SQLite "YYYY-MM-DD HH:MM:SS"); only the date part is compared.

const day = s => (s ? String(s).slice(0, 10) : null);
function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export const REMINDER_LABELS = {
  expiring: 'Expires within 3 days',
  expired: 'Expired with no order',
  stale: 'Sent 7+ days ago, no follow-up',
};

// q: { status, valid_until, sent_at, quotation_date, has_order, last_activity_at }
// Returns 'expiring' | 'expired' | 'stale' | null. Only quotations still 'sent' qualify —
// accepted/rejected/draft need nothing, and one that already became an order is done.
export function quotationFollowupReason(q, today) {
  if (!q || q.status !== 'sent' || q.has_order) return null;
  const valid = day(q.valid_until);
  if (valid && valid < today) return 'expired';
  if (valid && valid <= addDays(today, 3)) return 'expiring';
  const sent = day(q.sent_at) || day(q.quotation_date);
  if (sent && sent <= addDays(today, -7)) {
    const last = day(q.last_activity_at);
    if (!last || last <= sent) return 'stale';
  }
  return null;
}
