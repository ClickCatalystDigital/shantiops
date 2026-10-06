// lib/payment-reminders.js — daily overdue-payment nudges to the order's sales person (in-app
// notification, once a week per order). Rule lives in lib/payment-reminders.mjs. Runs from the same
// cron endpoint as the quotation reminders. Orders whose sales person isn't a real user (legacy
// names from the import) are skipped and counted, never guessed at.
import { queryAll, getAppSetting } from './db';
import { notifyUser } from './notify';
import { todayISO } from './date';
import { formatMoney } from './format';
import { needsPaymentReminder, weekKey, DEFAULT_REMINDER_DAYS } from './payment-reminders.mjs';
import { tabLink } from './alert-links.mjs';

const MAX_PER_RUN = 100;

export async function sweepPaymentReminders() {
  const today = todayISO();
  const days = Number(await getAppSetting('payment_reminder_days')) || DEFAULT_REMINDER_DAYS;
  const orders = await queryAll(
    `SELECT so.id, so.so_no, so.status, so.track_status, so.total, so.order_date, so.created_at,
            COALESCE(so.customer_name, c.name) AS customer_name,
            COALESCE(so.sales_person_override, so.created_by) AS owner,
            (SELECT COALESCE(SUM(p.amount), 0) FROM sale_order_payments p WHERE p.sale_order_id = so.id) AS received
       FROM sale_orders so LEFT JOIN customers c ON c.id = so.customer_id
      WHERE so.status != 'cancelled'`);
  const users = await queryAll('SELECT id, username, display_name FROM users WHERE active = 1');
  const byName = new Map();
  for (const u of users) { byName.set(u.username.toLowerCase(), u.id); if (u.display_name) byName.set(u.display_name.toLowerCase(), u.id); }
  const week = weekKey(today);
  let sent = 0, skippedNoOwner = 0;
  for (const o of orders) {
    if (!needsPaymentReminder(o, today, days)) continue;
    const uid = byName.get(String(o.owner || '').toLowerCase());
    if (!uid) { skippedNoOwner++; continue; }
    if (sent >= MAX_PER_RUN) break;
    sent += await notifyUser(uid, {
      kind: 'payment_followup',
      title: `Payment pending — ${o.so_no}${o.customer_name ? ` (${o.customer_name})` : ''}`,
      body: `${formatMoney(o.total - o.received)} of ${formatMoney(o.total)} still to collect.`,
      link: tabLink('/sales', 'payment_orders', { q: o.so_no, highlight: `SO-${o.id}` }), dedupe_key: `pay_reminder:${o.id}:${week}`,
    });
  }
  return { checked: orders.length, sent, skippedNoOwner };
}
