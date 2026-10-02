// app/api/amc/route.js — AMC management for Sales (SYSTEM.md §5dr), on the existing service_contracts table.
// GET: contracts with days committed / left, visits, value, received, cost, profit, plus the preventive-maintenance
// due list (active AMC contracts and items still under warranty that carry a PM schedule). POST: new contract.
import { NextResponse } from 'next/server';
import { execute, queryAll, nextCounterValue } from '@/lib/db';
import { getFreshSessionUser, canAccessDepartment } from '@/lib/auth';
import { todayISO } from '@/lib/date';
import { amcSummary, intervalDays, nextPmDue, pmStatus } from '@/lib/amc.mjs';
import { warrantyWindow } from '@/lib/installed-base.mjs';
import { audit } from '@/lib/usb';

const ok = user => user && canAccessDepartment(user, 'Sales');
const inList = a => a.map(() => '?').join(',');
const num = v => (v === '' || v == null ? null : Number(v));

export async function GET() {
  const user = await getFreshSessionUser();
  if (!ok(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const today = todayISO();
  const contracts = await queryAll(`SELECT sc.*, p.project_no, COALESCE(c.name, sc.customer_name) AS customer
      FROM service_contracts sc LEFT JOIN projects p ON p.id = sc.project_id LEFT JOIN customers c ON c.id = sc.customer_id ORDER BY sc.contract_no DESC LIMIT 500`);
  const projectIds = [...new Set(contracts.map(c => c.project_id).filter(Boolean))];
  const [costs, receipts, visits] = await Promise.all([
    queryAll('SELECT id, contract_id, cost_date, description, amount, created_by FROM service_contract_costs ORDER BY cost_date DESC, id DESC'),
    queryAll('SELECT id, contract_id, receipt_date, amount, received_by, note FROM service_contract_receipts ORDER BY receipt_date DESC, id DESC'),
    projectIds.length ? queryAll(`SELECT project_id, visit_date, status FROM installation_visits WHERE project_id IN (${inList(projectIds)})`, projectIds) : [],
  ]);
  const costsBy = new Map();
  for (const k of costs) { if (!costsBy.has(k.contract_id)) costsBy.set(k.contract_id, []); costsBy.get(k.contract_id).push(k); }
  const receiptsBy = new Map();
  for (const r of receipts) { if (!receiptsBy.has(r.contract_id)) receiptsBy.set(r.contract_id, []); receiptsBy.get(r.contract_id).push(r); }
  const visitsBy = new Map();
  for (const v of visits) { if (!visitsBy.has(v.project_id)) visitsBy.set(v.project_id, []); visitsBy.get(v.project_id).push(v); }

  const out = [], pm = [];
  for (const c of contracts) {
    const myCosts = costsBy.get(c.id) || [];
    const inTerm = (visitsBy.get(c.project_id) || []).filter(v => !c.start_date || !v.visit_date || v.visit_date >= c.start_date);
    const done = inTerm.filter(v => v.status === 'done');
    out.push({ ...c, costs: myCosts, receipts: receiptsBy.get(c.id) || [], summary: amcSummary(c, { costs: myCosts.reduce((t, k) => t + k.amount, 0), visitsDone: done.length, visitsPlanned: inTerm.length }, today) });
    if (c.status === 'active' && c.project_id) {
      const due = nextPmDue({ start: c.start_date, end: c.end_date, lastDone: done.map(v => v.visit_date).filter(Boolean).sort().pop() || null, interval: intervalDays(c.visit_frequency) });
      if (due) pm.push({ source: 'AMC', ref: `SVC-${c.contract_no}`, customer: c.customer, project_id: c.project_id, project_no: c.project_no, item: c.entitlement || 'AMC visit', every: c.visit_frequency, due, ...pmStatus(due, today) });
    }
  }

  // Items still under warranty that carry a preventive-maintenance schedule (sale order line → project → dispatch / commissioning dates).
  const items = await queryAll(`SELECT si.item_description, si.preventive_maintenance, si.warranty_std_days, si.warranty_accepted_days, si.from_date_of,
        so.id AS so_id, so.so_no, so.customer_name, p.id AS project_id, p.project_no
      FROM sale_order_items si JOIN sale_orders so ON so.id = si.sale_order_id JOIN projects p ON p.sale_order_id = so.id
     WHERE TRIM(COALESCE(si.preventive_maintenance,'')) <> '' AND COALESCE(so.status,'') != 'cancelled' LIMIT 400`);
  const pids = [...new Set(items.map(i => i.project_id))];
  if (pids.length) {
    const [dispatched, miles, vis] = await Promise.all([
      queryAll(`SELECT project_id, MAX(COALESCE(dispatched_at, updated_at)) AS at FROM packing_lists WHERE project_id IN (${inList(pids)}) AND status = 'dispatched' GROUP BY project_id`, pids),
      queryAll(`SELECT project_id, milestone_key, actual_end FROM milestones WHERE project_id IN (${inList(pids)}) AND milestone_key IN ('packing','site_installation','commissioning') AND actual_end IS NOT NULL`, pids),
      queryAll(`SELECT project_id, MAX(visit_date) AS last FROM installation_visits WHERE project_id IN (${inList(pids)}) AND status = 'done' GROUP BY project_id`, pids),
    ]);
    const dates = new Map(pids.map(id => [id, { deliveredOn: null, installedOn: null }]));
    for (const d of dispatched) dates.get(d.project_id).deliveredOn = d.at;
    for (const m of miles) {
      const d = dates.get(m.project_id);
      if (m.milestone_key === 'packing' && !d.deliveredOn) d.deliveredOn = m.actual_end;
      if (m.milestone_key === 'commissioning') d.installedOn = m.actual_end;
      if (m.milestone_key === 'site_installation' && !d.installedOn) d.installedOn = m.actual_end;
    }
    const lastBy = new Map(vis.map(v => [v.project_id, v.last]));
    for (const it of items) {
      const w = warrantyWindow(it, dates.get(it.project_id), today);
      if (w.status !== 'active') continue;
      const due = nextPmDue({ start: w.start, end: w.end, lastDone: lastBy.get(it.project_id) || null, interval: intervalDays(it.preventive_maintenance) });
      if (due) pm.push({ source: 'Warranty', ref: it.so_no, customer: it.customer_name, project_id: it.project_id, project_no: it.project_no, item: it.item_description, every: it.preventive_maintenance, due, ...pmStatus(due, today) });
    }
  }
  pm.sort((a, b) => a.days - b.days);
  return NextResponse.json({ contracts: out, pm, today });
}

export async function POST(req) {
  const user = await getFreshSessionUser();
  if (!ok(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const b = await req.json().catch(() => ({}));
  if (!String(b.customer_name || '').trim()) return NextResponse.json({ error: 'Customer is required' }, { status: 400 });
  if (!b.start_date || !b.end_date || b.end_date < b.start_date) return NextResponse.json({ error: 'Start and end dates are required (end after start)' }, { status: 400 });
  const contractNo = await nextCounterValue('service_contract_no');
  const { lastId } = await execute(
    `INSERT INTO service_contracts (contract_no, project_id, customer_id, customer_name, start_date, end_date, visit_frequency, entitlement, contract_value, received_value, created_by, service_engineer)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [contractNo, b.project_id || null, b.customer_id || null, b.customer_name.trim(), b.start_date, b.end_date, b.visit_frequency || null, b.entitlement || null, num(b.contract_value), num(b.received_value) ?? 0, user.username, String(b.service_engineer || '').trim() || null]);
  await audit('service_contract_created', { actor: user.username, detail: `SVC-${contractNo}: ${b.customer_name} (AMC, Sales)` });
  return NextResponse.json({ id: Number(lastId), contract_no: contractNo });
}
