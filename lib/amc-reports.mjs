// lib/amc-reports.mjs — the three Sales AMC money reports (2026-10-02). Pure; selfcheck in lib/amc-reports-selfcheck.mjs.
// A contract: { id, contract_no, customer, status, end_date, contract_value, received_value, service_engineer }.
// A receipt:  { contract_id, receipt_date, amount, received_by }.
// Months are 'YYYY-MM'. "Due" = the month the contract ends (its renewal / balance falls due).
const ym = d => String(d || '').slice(0, 7);
const inRange = (m, from, to) => !!m && (!from || m >= from) && (!to || m <= to);
const n = v => Number(v) || 0;
const byId = list => new Map(list.map(c => [c.id, c]));
export const NO_ENGINEER = '(not assigned)';

// Contracts falling due in the range, with what is still to be collected.
export function amcDue(contracts, { from, to } = {}) {
  const rows = contracts
    .filter(c => c.status !== 'cancelled' && inRange(ym(c.end_date), from, to))
    .map(c => ({ month: ym(c.end_date), customer: c.customer || '(no customer)', contract_no: c.contract_no, end_date: c.end_date, status: c.status,
      value: n(c.contract_value), received: n(c.received_value), balance: Math.max(0, n(c.contract_value) - n(c.received_value)) }))
    .sort((a, b) => a.month.localeCompare(b.month) || a.customer.localeCompare(b.customer));
  const sum = k => rows.reduce((t, r) => t + r[k], 0);
  return { rows, totals: { value: sum('value'), received: sum('received'), balance: sum('balance') } };
}

// Money received in the range by month and customer, plus whatever older contracts hold as an undated total.
export function amcReceived(contracts, receipts, { from, to } = {}) {
  const by = byId(contracts), logged = new Map();
  const agg = new Map();
  for (const r of receipts) {
    logged.set(r.contract_id, (logged.get(r.contract_id) || 0) + n(r.amount));
    const c = by.get(r.contract_id); const month = ym(r.receipt_date);
    if (!c || !inRange(month, from, to)) continue;
    const customer = c.customer || '(no customer)', k = `${month}|${customer}`;
    const a = agg.get(k) || { month, customer, receipts: 0, amount: 0 };
    a.receipts += 1; a.amount += n(r.amount); agg.set(k, a);
  }
  const rows = [...agg.values()].sort((a, b) => a.month.localeCompare(b.month) || a.customer.localeCompare(b.customer));
  const undated = contracts.reduce((t, c) => t + Math.max(0, n(c.received_value) - (logged.get(c.id) || 0)), 0);
  return { rows, total: rows.reduce((t, r) => t + r.amount, 0), undated };
}

// Per service engineer: money collected in the range (the receipt's collector, else the contract's engineer),
// and the contracts they look after with value and what is still outstanding.
export function amcByEngineer(contracts, receipts, { from, to } = {}) {
  const by = byId(contracts), out = new Map();
  const get = name => { if (!out.has(name)) out.set(name, { engineer: name, receipts: 0, collected: 0, contracts: 0, value: 0, received: 0, balance: 0 }); return out.get(name); };
  for (const r of receipts) {
    const c = by.get(r.contract_id);
    if (!c || !inRange(ym(r.receipt_date), from, to)) continue;
    const e = get((r.received_by || c.service_engineer || '').trim() || NO_ENGINEER);
    e.receipts += 1; e.collected += n(r.amount);
  }
  for (const c of contracts.filter(c => c.status === 'active')) {
    const e = get((c.service_engineer || '').trim() || NO_ENGINEER);
    e.contracts += 1; e.value += n(c.contract_value); e.received += n(c.received_value);
    e.balance += Math.max(0, n(c.contract_value) - n(c.received_value));
  }
  const rows = [...out.values()].sort((a, b) => b.collected - a.collected || a.engineer.localeCompare(b.engineer));
  return { rows, total: rows.reduce((t, r) => t + r.collected, 0) };
}
