// lib/service-expenses.js — DB side of the Service Cash Request / Travel Allowance forms.
// Rules (totals, validation, advance eligibility) live in lib/service-expense.mjs.
import { queryAll, queryOne } from './db';
import { notifyUser } from './notify';

export function hydrate(r) {
  if (!r) return r;
  const data = JSON.parse(r.data_json || '{}');
  return { ...r, data_json: undefined, customers_json: undefined, data, customers: JSON.parse(r.customers_json || '[]'), purpose: data.purpose || '' };
}

export async function listRequests({ where = '1=1', params = [], limit = 300 } = {}) {
  const rows = await queryAll(`SELECT * FROM service_expense_requests WHERE ${where} ORDER BY id DESC LIMIT ${Number(limit)}`, params);
  const ids = rows.filter(r => r.kind === 'travel').map(r => r.id);
  const funded = ids.length
    ? await queryAll(`SELECT id, req_no, amount, used_by FROM service_expense_requests WHERE used_by IN (${ids.map(() => '?').join(',')})`, ids)
    : [];
  return rows.map(r => ({ ...hydrate(r), advances: funded.filter(f => f.used_by === r.id).map(f => ({ id: f.id, req_no: f.req_no, amount: f.amount })) }));
}

export async function getRequest(id) {
  const [r] = await listRequests({ where: 'id = ?', params: [id], limit: 1 });
  return r || null;
}

// Approved cash requests not yet funding a claim (the caller narrows by customer).
export function advanceCandidates() {
  return listRequests({ where: `kind = 'cash' AND status IN ('with_accounts','settled') AND used_by IS NULL`, limit: 500 });
}

export async function notifyRole(roles, note) {
  const users = await queryAll(`SELECT id FROM users WHERE active = 1 AND pending = 0 AND role IN (${roles.map(() => '?').join(',')})`, roles);
  for (const u of users) await notifyUser(u.id, note);
}

export async function notifyRequester(req, note) {
  const u = await queryOne('SELECT id FROM users WHERE username = ?', [req.requested_by]);
  if (u) await notifyUser(u.id, note);
}
