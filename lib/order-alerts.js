// lib/order-alerts.js — daily nudge to the sales owner about orders that look stuck (SYSTEM.md §5dr). Rule in
// lib/order-alerts.mjs. Same cron endpoint as the quotation / payment reminders; once a week per order and reason.
// Only orders from the last 180 days (the 1,000+ imported history is not nagged about), and only owners who are real users.
import { queryAll } from './db';
import { notifyUser } from './notify';
import { todayISO } from './date';
import { weekKey } from './payment-reminders.mjs';
import { orderAlertReason, ORDER_ALERT_LABEL } from './order-alerts.mjs';

const MAX_PER_RUN = 100;

export async function sweepOrderAlerts() {
  const today = todayISO();
  const orders = await queryAll(
    `SELECT so.id, so.so_no, so.status, so.track_status, so.order_date, so.created_at, so.expected_delivery_date,
            COALESCE(so.customer_name, c.name) AS customer_name, COALESCE(so.sales_person_override, so.created_by) AS owner,
            (SELECT pl.status FROM packing_lists pl JOIN projects pp ON pp.id = pl.project_id WHERE pp.sale_order_id = so.id ORDER BY pl.id DESC LIMIT 1) AS packing_status
       FROM sale_orders so LEFT JOIN customers c ON c.id = so.customer_id
      WHERE so.status != 'cancelled' AND COALESCE(so.order_date, so.created_at) >= date('now', '-180 day')`);
  const users = await queryAll('SELECT id, username, display_name FROM users WHERE active = 1');
  const byName = new Map();
  for (const u of users) { byName.set(u.username.toLowerCase(), u.id); if (u.display_name) byName.set(u.display_name.toLowerCase(), u.id); }
  const week = weekKey(today);
  let sent = 0;
  for (const o of orders) {
    const reason = orderAlertReason(o, today);
    const uid = reason && byName.get(String(o.owner || '').toLowerCase());
    if (!uid) continue;
    if (sent >= MAX_PER_RUN) break;
    sent += await notifyUser(uid, {
      kind: 'order_alert', title: `Order ${o.so_no} needs attention${o.customer_name ? ` — ${o.customer_name}` : ''}`,
      body: ORDER_ALERT_LABEL[reason], dedupe_key: `order_alert:${o.id}:${reason}:${week}`,
    });
  }
  return { checked: orders.length, sent };
}
