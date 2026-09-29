// lib/sales-retention.mjs — Sales history retention window (off by default).
// Pure: no DB import. Builds the ONE eligibility query that the preview, the backup workbook and the
// delete all use, so the numbers shown, the file downloaded and the rows deleted are always the same.
// Covered: Diary/follow-up notes (+ their attachments) and enquiry stage history, Sales-owned only.
// Never covered: quotations, orders, invoices, payments, audit log. Adding a source = one entry below.
//
// Protected even when old: the latest note per enquiry / per customer, the latest stage row per
// enquiry, and any note with a follow-up still planned (next_plan_date today or later).

// months; 24/36/48/60 read as years in the UI
export const RETENTION_OPTIONS = [1, 2, 3, 5, 6, 8, 10, 12, 18, 24, 36, 48, 60];
export const retentionLabel = m => (m % 12 === 0 && m >= 24 ? `${m / 12} years` : m === 1 ? '1 month' : `${m} months`);
export const retentionShort = m => (m % 12 === 0 && m >= 24 ? `${m / 12}Y` : `${m}M`);
export const DEFAULT_RETENTION = { enabled: false, months: null };
export const BACKUP_VALID_MS = 60 * 60 * 1000;

// "2026-09-30", 12 -> "2025-09-30" (a day past month end clamps: Mar 31 - 1 month = Feb 28).
export function cutoffDate(todayIso, months) {
  const [y, m, d] = todayIso.split('-').map(Number);
  const t = y * 12 + (m - 1) - months;
  const ny = Math.floor(t / 12), nm = t % 12;
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return `${ny}-${String(nm + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

// The stricter (earlier) of two ISO dates — a backup can never widen what a later run deletes.
export const effectiveCutoff = (a, b) => (a < b ? a : b);

export function normalizeRetention(raw) {
  const months = Number(raw?.months);
  const ok = RETENTION_OPTIONS.includes(months);
  return { enabled: !!raw?.enabled && ok, months: ok ? months : null };
}

// age of a note: its visit date, else the day it was written; never a guess when both are empty.
const NOTE_AGE = a => `COALESCE(${a}.visit_date, substr(${a}.created_at, 1, 10))`;

export const RETENTION_SOURCES = {
  crm_notes: {
    label: 'Follow-ups (Diary notes)', table: 'crm_notes', children: [{ table: 'crm_note_files', fk: 'note_id' }],
    // cols shown in the backup sheet
    columns: 'n.id, n.lead_id, n.customer_id, n.note_type, n.content, n.visit_date, n.action_taken, n.plan_of_action, n.plan_note_type, n.plan_for, n.next_plan_date, n.created_by, n.created_at',
    from: 'crm_notes n', alias: 'n', ageSql: NOTE_AGE('n'),
    where: ({ today }) => ({
      sql: `${NOTE_AGE('n')} IS NOT NULL AND ${NOTE_AGE('n')} < ?
        AND n.opportunity_id IS NULL
        AND (n.next_plan_date IS NULL OR n.next_plan_date < ?)
        AND (n.lead_id IS NULL OR EXISTS (SELECT 1 FROM leads l WHERE l.id = n.lead_id AND l.owner_dept = 'Sales'))
        AND NOT (n.lead_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM crm_notes o WHERE o.lead_id = n.lead_id AND o.id <> n.id
              AND (${NOTE_AGE('o')} > ${NOTE_AGE('n')} OR (${NOTE_AGE('o')} = ${NOTE_AGE('n')} AND o.id > n.id))))
        AND NOT (n.customer_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM crm_notes o WHERE o.customer_id = n.customer_id AND o.id <> n.id
              AND (${NOTE_AGE('o')} > ${NOTE_AGE('n')} OR (${NOTE_AGE('o')} = ${NOTE_AGE('n')} AND o.id > n.id))))`,
      // ? order: cutoff, today (the two placeholders appear once each, in this order)
      order: ['cutoff', 'today'],
    }),
  },
  lead_stage_history: {
    label: 'Enquiry stage history', table: 'lead_stage_history', children: [],
    columns: 'h.id, h.lead_id, h.from_stage, h.to_stage, h.changed_by, h.changed_at',
    from: 'lead_stage_history h', alias: 'h', ageSql: 'substr(h.changed_at, 1, 10)',
    where: () => ({
      sql: `h.changed_at IS NOT NULL AND substr(h.changed_at, 1, 10) < ?
        AND EXISTS (SELECT 1 FROM leads l WHERE l.id = h.lead_id AND l.owner_dept = 'Sales')
        AND EXISTS (SELECT 1 FROM lead_stage_history o WHERE o.lead_id = h.lead_id AND o.id <> h.id
              AND (o.changed_at > h.changed_at OR (o.changed_at = h.changed_at AND o.id > h.id)))`,
      order: ['cutoff'],
    }),
  },
};
export const RETENTION_SOURCE_KEYS = Object.keys(RETENTION_SOURCES);

// -> { sql, args } for a source. maxId (from the backup) caps which rows may be touched.
export function eligibleQuery(key, { cutoff, today, maxId = null }, select = 'COUNT(*) AS n, MIN(__AGE__) AS oldest') {
  const s = RETENTION_SOURCES[key];
  const w = s.where({ cutoff, today });
  const vals = { cutoff, today };
  const args = w.order.map(k => vals[k]);
  let sql = `SELECT ${select.replace('__AGE__', s.ageSql)} FROM ${s.from} WHERE ${w.sql}`;
  if (maxId != null) { sql += ` AND ${s.alias}.id <= ?`; args.push(maxId); }
  return { sql, args };
}
