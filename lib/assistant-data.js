// lib/assistant-data.js — the read-only look-ups the assistant may run for a "live data" question.
// Used only when live-data answers are switched on (Settings → Assistant, with a recorded approval),
// because the rows returned are sent to OpenRouter to be worded.
// Each look-up runs as the signed-in user: `who` says which departments may use it. None changes anything.
// Jev picks the look-up (it can only choose, not fill in values), so identifiers such as a project
// or order number are read from the question with plain patterns.
import { queryAll, queryOne } from './db';
import { isPM, canAccessDepartment, isDepartmentHead, headDepartments } from './auth';
import { getReorderSuggestions, getPendingInwardApprovals, getPendingPreDispatchApprovals } from './data';
import { todayISO } from './date';
import { words } from './assistant-help.mjs';

// Words that describe the request, not the thing looked for.
const GENERIC = new Set('much many stock hand have left available item items material quantity qty owe owes owed outstanding pending payment payments due dues customer customers money balance now right today current currently show tell give list status order orders project store stores inventory received paid amount total value'.split(' '));
const terms = q => words(q).filter(w => w.length >= 3 && !GENERIC.has(w)).sort((a, b) => b.length - a.length);
// Words that look like a document number: they contain a digit, e.g. SB-1109, STF-IBR-052, SAS-322, DN20.
const numbers = q => String(q).split(/\s+/).map(s => s.replace(/^[^\w]+|[^\w]+$/g, '')).filter(s => /\d/.test(s) && s.length >= 3);
const money = n => Math.round(Number(n) || 0);

const salesMoney = u => isPM(u) || canAccessDepartment(u, 'Accounts') || isDepartmentHead(u, 'Sales');
const any = (...depts) => u => isPM(u) || depts.some(d => canAccessDepartment(u, d));

export const DATA_TOOLS = [
  {
    key: 'open_tasks', label: 'Open tasks', who: () => true,
    about: 'Open tasks or to-dos waiting for me or my department',
    async run(user) {
      const depts = headDepartments(user);
      const rows = await queryAll(
        `SELECT title, department, due_date, assigned_to FROM tasks WHERE status = 'open'
         ${isPM(user) ? '' : `AND department IN (${depts.map(() => '?').join(',') || "''"})`}
         ORDER BY due_date IS NULL, due_date LIMIT 15`, isPM(user) ? [] : depts);
      return { rows, link: '/' };
    },
  },
  {
    key: 'project_status', label: 'Project status', who: () => true,
    about: 'Progress, current stage or delay of one project, when a project number such as SB-1109 is given',
    async run(user, q) {
      let p = null;
      for (const n of numbers(q)) {
        p = await queryOne(`SELECT id, project_no, customer_name, order_date FROM projects WHERE is_system = 0 AND (project_no = ? COLLATE NOCASE OR project_no LIKE ?) ORDER BY LENGTH(project_no) LIMIT 1`, [n, `${n}%`]);
        if (p) break;
      }
      if (!p) return { rows: [], note: 'No project number was found in the question, or no project has that number.' };
      const ms = await queryAll('SELECT milestone_label, department, status, planned_end, actual_end FROM milestones WHERE project_id = ? ORDER BY sort_order', [p.id]);
      const today = todayISO();
      return {
        rows: [{
          project: p.project_no, customer: p.customer_name, order_date: p.order_date,
          milestones_done: ms.filter(m => m.status === 'done').length, milestones_total: ms.length,
          in_progress: ms.filter(m => m.status === 'in_progress').map(m => `${m.milestone_label} (${m.department})`),
          overdue: ms.filter(m => m.status !== 'done' && m.planned_end && m.planned_end < today).map(m => `${m.milestone_label}, due ${m.planned_end}`),
          next: ms.find(m => m.status === 'pending')?.milestone_label || null,
        }],
        link: `/projects/${p.id}`,
      };
    },
  },
  {
    key: 'order_payment', label: 'Order value and payments', who: salesMoney,
    about: 'Order value, amount received and amount still pending for one sale order, when an order number is given',
    async run(user, q) {
      for (const n of numbers(q)) {
        const o = await queryOne(
          `SELECT so.so_no, so.customer_name, so.total, so.track_status, so.order_date,
                  COALESCE((SELECT SUM(amount) FROM sale_order_payments p WHERE p.sale_order_id = so.id), 0) AS received
             FROM sale_orders so WHERE so.so_no = ? COLLATE NOCASE LIMIT 1`, [n]);
        if (o) return { rows: [{ order: o.so_no, customer: o.customer_name, order_date: o.order_date, status: o.track_status, order_value: money(o.total), received: money(o.received), pending: money(o.total - o.received) }], link: '/sales?tab=payment-tracker' };
      }
      return { rows: [], note: 'No sale order number was found in the question, or no order has that number.' };
    },
  },
  {
    key: 'customer_outstanding', label: 'Outstanding by customer', who: salesMoney,
    about: 'How much a customer owes, or which customers owe the most (order value minus payments received)',
    async run(user, q) {
      const sql = name => queryAll(
        `SELECT so.customer_name AS customer, COUNT(*) AS orders, SUM(so.total) AS order_value,
                SUM(COALESCE((SELECT SUM(amount) FROM sale_order_payments p WHERE p.sale_order_id = so.id), 0)) AS received
           FROM sale_orders so WHERE COALESCE(so.status, '') != 'cancelled' ${name ? 'AND so.customer_name LIKE ?' : ''}
          GROUP BY so.customer_name HAVING SUM(so.total) - received > 1 ORDER BY SUM(so.total) - received DESC LIMIT 10`, name ? [`%${name}%`] : []);
      let rows = [], matched = null;
      for (const t of terms(q).slice(0, 4)) { rows = await sql(t); if (rows.length) { matched = t; break; } }
      if (!rows.length) rows = await sql(null);
      return {
        rows: rows.map(r => ({ customer: r.customer, orders: r.orders, order_value: money(r.order_value), received: money(r.received), outstanding: money(r.order_value - r.received) })),
        note: matched ? `Customers whose name contains "${matched}".` : 'Top 10 customers by outstanding amount, all companies.', link: '/sales?tab=payment-tracker',
      };
    },
  },
  {
    key: 'open_purchase_orders', label: 'Purchase orders not yet received', who: any('Procurement', 'Stores'),
    about: 'Purchase orders that are issued but not fully received; the oldest or late ones',
    async run() {
      const rows = await queryAll(
        `SELECT po.po_no, s.name AS supplier, po.issued_at, COUNT(*) AS lines_not_received
           FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id
           JOIN po_items pi ON pi.po_id = po.id JOIN bom_items b ON b.id = pi.bom_item_id
          WHERE po.status = 'issued' AND b.purchase_status IN ('Ordered', 'Transit')
          GROUP BY po.id ORDER BY po.issued_at LIMIT 15`);
      return { rows, note: 'Oldest first. Expected dates are on Procurement → Delivery Lots.', link: '/procurement?tab=orders' };
    },
  },
  {
    key: 'stock_on_hand', label: 'Stock on hand', who: any('Stores', 'Procurement', 'Production'),
    about: 'How much of a named item or material is in stock',
    async run(user, q) {
      const t = terms(q).slice(0, 3);
      if (!t.length) return { rows: [], note: 'Name the item to look for.' };
      const find = ws => queryAll(`SELECT description, item_code, on_hand, location FROM inventory_items WHERE ${ws.map(() => 'description LIKE ?').join(' AND ')} ORDER BY on_hand DESC LIMIT 12`, ws.map(w => `%${w}%`));
      let rows = await find(t);
      for (let i = 0; !rows.length && i < t.length; i++) rows = await find([t[i]]);
      return { rows, note: 'On hand in Stores. Reserved quantities are on the Inventory tab.', link: '/stores' };
    },
  },
  {
    key: 'low_stock', label: 'Items below minimum', who: any('Stores', 'Procurement'),
    about: 'Items at or below their minimum stock level that need reordering',
    async run() {
      const rows = (await getReorderSuggestions()).slice(0, 15).map(r => ({ description: r.description, item_code: r.item_code, on_hand: r.on_hand, available: r.available, minimum: r.reorder_point }));
      return { rows, link: '/pr' };
    },
  },
  {
    key: 'pending_approvals', label: 'Approvals waiting', who: any('QC', 'Production', 'Dispatch'),
    about: 'Inward quality reviews and pre-dispatch approvals that are waiting for a decision',
    async run() {
      const [inward, pre] = await Promise.all([getPendingInwardApprovals(), getPendingPreDispatchApprovals()]);
      return {
        rows: [
          ...inward.slice(0, 8).map(r => ({ type: 'Inward review', project: r.project_no, item: r.material_description, received_at: r.received_at })),
          ...pre.slice(0, 8).map(r => ({ type: 'Pre-dispatch', project: r.project_no, packing_list: r.packing_no, qc: r.qc_decision || 'waiting', production: r.production_decision || 'waiting' })),
        ],
        note: `${inward.length} inward reviews and ${pre.length} pre-dispatch approvals waiting in total.`, link: '/qc',
      };
    },
  },
];

export const toolsFor = user => DATA_TOOLS.filter(t => t.who(user));
