// app/api/amc/[id]/route.js — AMC contract actions for Sales (SYSTEM.md §5dr). PATCH body `action`:
//   (none)        edit fields   | renew  new contract from this one | cancel
//   add_cost      {cost_date, description, amount} | delete_cost {cost_id} | schedule_pm {visit_date, visited_by?} → a planned visit on the Home calendar
import { NextResponse } from 'next/server';
import { execute, queryOne, nextCounterValue } from '@/lib/db';
import { getFreshSessionUser, canAccessDepartment } from '@/lib/auth';
import { audit } from '@/lib/usb';

const FIELDS = ['customer_name', 'start_date', 'end_date', 'visit_frequency', 'entitlement', 'contract_value', 'received_value'];
const num = v => (v === '' || v == null ? null : Number(v));

export async function PATCH(req, { params }) {
  const user = await getFreshSessionUser();
  if (!user || !canAccessDepartment(user, 'Sales')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const c = await queryOne('SELECT * FROM service_contracts WHERE id = ?', [params.id]);
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const b = await req.json().catch(() => ({}));
  const tag = `SVC-${c.contract_no}`;

  if (b.action === 'add_cost') {
    const amount = Number(b.amount);
    if (!(amount > 0) || !b.cost_date) return NextResponse.json({ error: 'A date and an amount above zero are required' }, { status: 400 });
    await execute('INSERT INTO service_contract_costs (contract_id, cost_date, description, amount, created_by) VALUES (?, ?, ?, ?, ?)', [c.id, b.cost_date, String(b.description || '').slice(0, 200) || null, amount, user.username]);
    await audit('service_contract_cost_added', { actor: user.username, detail: `${tag}: ${amount}` });
    return NextResponse.json({ ok: true });
  }
  if (b.action === 'delete_cost') {
    await execute('DELETE FROM service_contract_costs WHERE id = ? AND contract_id = ?', [b.cost_id, c.id]);
    await audit('service_contract_cost_deleted', { actor: user.username, detail: `${tag}: cost ${b.cost_id}` });
    return NextResponse.json({ ok: true });
  }
  if (b.action === 'schedule_pm') {
    if (!c.project_id) return NextResponse.json({ error: 'Link this contract to a project to schedule visits' }, { status: 400 });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(b.visit_date || '')) return NextResponse.json({ error: 'Visit date is required' }, { status: 400 });
    const row = await queryOne('SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM installation_visits WHERE project_id = ?', [c.project_id]);
    await execute(`INSERT INTO installation_visits (project_id, seq, description, visit_date, visit_time, visited_by, status, created_by) VALUES (?, ?, ?, ?, ?, ?, 'planned', ?)`,
      [c.project_id, row.n, `Preventive maintenance (${tag})`, b.visit_date, b.visit_time || null, b.visited_by || null, user.username]);
    await audit('installation_visit_added', { actor: user.username, detail: `project ${c.project_id}: PM visit for ${tag}` });
    return NextResponse.json({ ok: true });
  }
  if (b.action === 'renew') {
    if (c.status !== 'active' && c.status !== 'expired') return NextResponse.json({ error: `Cannot renew from ${c.status}` }, { status: 409 });
    if (!b.start_date || !b.end_date || b.end_date < b.start_date) return NextResponse.json({ error: 'New start and end dates are required' }, { status: 400 });
    const no = await nextCounterValue('service_contract_no');
    const { lastId } = await execute(
      `INSERT INTO service_contracts (contract_no, project_id, customer_id, customer_name, start_date, end_date, visit_frequency, entitlement, contract_value, received_value, renewed_from_id, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      [no, c.project_id, c.customer_id, c.customer_name, b.start_date, b.end_date, c.visit_frequency, c.entitlement, num(b.contract_value) ?? c.contract_value, c.id, user.username]);
    await execute("UPDATE service_contracts SET status = 'renewed' WHERE id = ?", [c.id]);
    await audit('service_contract_renewed', { actor: user.username, detail: `${tag} -> SVC-${no}` });
    return NextResponse.json({ id: Number(lastId), contract_no: no });
  }
  if (b.action === 'cancel') {
    await execute("UPDATE service_contracts SET status = 'cancelled' WHERE id = ?", [c.id]);
    await audit('service_contract_cancel', { actor: user.username, detail: `${tag} -> cancelled` });
    return NextResponse.json({ ok: true });
  }

  const sets = [], args = [];
  for (const f of FIELDS) {
    if (!(f in b)) continue;
    sets.push(`${f} = ?`); args.push(f === 'contract_value' || f === 'received_value' ? num(b[f]) : (b[f] || null));
  }
  if (!sets.length) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
  await execute(`UPDATE service_contracts SET ${sets.join(', ')} WHERE id = ?`, [...args, c.id]);
  await audit('service_contract_updated', { actor: user.username, detail: `${tag}: ${Object.keys(b).join(',')}` });
  return NextResponse.json({ ok: true });
}
