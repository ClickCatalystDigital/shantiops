// lib/service-expenses.js — DB side of the Service Cash Request / Travel Allowance forms.
// Rules (totals, validation, advance eligibility) live in lib/service-expense.mjs.
import { queryAll, queryOne } from './db';
import { notifyUser } from './notify';
import { canAccessDepartment, isPM } from './auth';
import { remainingOf } from './service-expense.mjs';

export function hydrate(r) {
  if (!r) return r;
  const data = JSON.parse(r.data_json || '{}');
  return { ...r, data_json: undefined, customers_json: undefined, data, customers: JSON.parse(r.customers_json || '[]'), purpose: data.purpose || '' };
}

export async function listRequests({ where = '1=1', params = [], limit = 300 } = {}) {
  const rows = await queryAll(`SELECT * FROM service_expense_requests WHERE ${where} ORDER BY id DESC LIMIT ${Number(limit)}`, params);
  const ids = rows.map(r => r.id);
  const links = ids.length
    ? await queryAll(
      `SELECT a.cash_id, a.travel_id, a.amount, c.req_no AS cash_no, t.req_no AS travel_no
         FROM service_expense_advances a
         JOIN service_expense_requests c ON c.id = a.cash_id JOIN service_expense_requests t ON t.id = a.travel_id
        WHERE t.status != 'rejected' AND (a.cash_id IN (${ids.map(() => '?').join(',')}) OR a.travel_id IN (${ids.map(() => '?').join(',')}))`, [...ids, ...ids])
    : [];
  return rows.map(r => {
    const h = hydrate(r);
    if (r.kind === 'travel') return { ...h, advances: links.filter(l => l.travel_id === r.id).map(l => ({ id: l.cash_id, req_no: l.cash_no, amount: l.amount })) };
    // Cash request: where its money went, and what is left (see lib/service-expense.mjs remainingOf).
    const applied = links.filter(l => l.cash_id === r.id).map(l => ({ travel_id: l.travel_id, req_no: l.travel_no, amount: l.amount }));
    return { ...h, applied, remaining: remainingOf({ amount: r.amount, applied }) };
  });
}

export async function getRequest(id) {
  const [r] = await listRequests({ where: 'id = ?', params: [id], limit: 1 });
  return r || null;
}

// Approved cash requests (the caller keeps those with money left — eligibleAdvances).
export function advanceCandidates() {
  return listRequests({ where: `kind = 'cash' AND status IN ('with_accounts','settled')`, limit: 500 });
}

export async function notifyRole(roles, note) {
  const users = await queryAll(`SELECT id FROM users WHERE active = 1 AND pending = 0 AND role IN (${roles.map(() => '?').join(',')})`, roles);
  for (const u of users) await notifyUser(u.id, note);
}

export async function notifyRequester(req, note) {
  const u = await queryOne('SELECT id FROM users WHERE username = ?', [req.requested_by]);
  if (u) await notifyUser(u.id, note);
}

// Own request, any PM, or Accounts once it has reached them.
export function canView(user, r) {
  return r.requested_by === user.username || isPM(user) || (canAccessDepartment(user, 'Accounts') && ['with_accounts', 'settled'].includes(r.status));
}
