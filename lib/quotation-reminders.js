// lib/quotation-reminders.js — Sales CRM plan 2d. Finds sent quotations that need a follow-up
// (lib/quotation-reminders.mjs rule) and notifies the owner once per quotation + reason.
// Runs daily from the cron Worker (POST /api/sales/quotation-reminders) and, as a backup,
// opportunistically on the notification bell's read path at most once an hour.
import { queryAll, queryOne, getAppSetting, setAppSetting } from './db';
import { notifyUser } from './notify';
import { todayISO } from './date';
import { quotationFollowupReason, REMINDER_LABELS } from './quotation-reminders.mjs';

// Every 'sent' quotation with what the rule needs: a linked order, and the latest Diary note on
// its enquiry. Owner = the enquiry's A/C manager, else assignee, else whoever made the quotation.
export async function getQuotationFollowupRows() {
  return queryAll(
    `SELECT q.id, q.quotation_no, q.status, q.valid_until, q.sent_at, q.quotation_date, q.lead_id, q.created_by,
            c.name AS customer_name,
            EXISTS (SELECT 1 FROM sale_orders so WHERE so.quotation_id = q.id) AS has_order,
            (SELECT MAX(n.created_at) FROM crm_notes n WHERE q.lead_id IS NOT NULL AND n.lead_id = q.lead_id) AS last_activity_at,
            COALESCE(NULLIF(l.account_manager, ''), NULLIF(l.assigned_to, ''), q.created_by) AS owner
       FROM quotations q JOIN customers c ON c.id = q.customer_id LEFT JOIN leads l ON l.id = q.lead_id
      WHERE q.status = 'sent'`
  );
}

export async function sweepQuotationReminders() {
  const today = todayISO();
  const rows = await getQuotationFollowupRows();
  let sent = 0;
  for (const q of rows) {
    const reason = quotationFollowupReason(q, today);
    if (!reason || !q.owner) continue;
    const u = await queryOne('SELECT id FROM users WHERE active = 1 AND username = ?', [q.owner]);
    if (!u) continue;
    sent += await notifyUser(u.id, {
      kind: 'quotation_followup',
      title: `Follow up ${q.quotation_no} — ${q.customer_name}`,
      body: REMINDER_LABELS[reason],
      dedupe_key: `quote_reminder:${q.id}:${reason}`,
    });
  }
  await setAppSetting('quotation_reminders_last_run', new Date().toISOString());
  return { checked: rows.length, sent };
}

// Backup path — at most once an hour, never throws into the caller.
export async function maybeSweepQuotationReminders() {
  try {
    const last = await getAppSetting('quotation_reminders_last_run');
    if (last && Date.now() - Date.parse(last) < 60 * 60 * 1000) return;
    await sweepQuotationReminders();
  } catch (err) {
    console.error('quotation reminders sweep', err);
  }
}
