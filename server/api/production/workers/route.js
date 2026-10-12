// Shop-floor workers. These people never log in — this is a roster, not an account. Writes go to
// the unified `employees` master (PRODUCTION-MODULE-DESIGN.md §2.5, employee_type='worker'), not a
// separate Production-only table — that split is exactly what drifted out of sync last time.
//
// GET (search) exists so Add-worker searches HR first and only creates a new person when nothing
// matches — Production creating identities blind is the same drift bug one level up: two rows for
// one human because nobody checked. Returns minimal fields only (no salary/bank/personal columns
// from `employees`) since a Production head, not an HR head, is the caller.
import { NextResponse } from 'next/server';
import { execute, queryAll, nextCounterValue } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { audit } from '@/lib/usb';

export async function GET(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Production');
  if (denied) return denied;

  const search = new URL(req.url).searchParams.get('search')?.trim();
  if (!search) return NextResponse.json([]);
  const rows = await queryAll(
    `SELECT id, name, employee_code, trade, department, employee_type, active
       FROM employees WHERE name LIKE ? OR employee_code LIKE ? ORDER BY name LIMIT 20`,
    [`%${search}%`, `%${search}%`]
  );
  return NextResponse.json(rows);
}

export async function POST(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Production');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Production', 'production.worker.write');
  if (actionDenied) return actionDenied;

  const b = await req.json();
  const trade = String(b.trade || '').trim() || null;

  // Path 1: activate an existing HR employee onto the Production roster (the normal path, after a
  // search). Restricted to employee_type='worker' — reassigning a staff record into Production is
  // a real HR decision (designation/reporting-line implications), not a one-click floor action.
  if (b.employee_id) {
    const emp = await execute('SELECT id FROM employees WHERE id = ? AND employee_type = ?', [Number(b.employee_id), 'worker']);
    if (!emp.rows?.length) {
      return NextResponse.json({ error: 'Not a worker-type HR record — ask HR to reassign this person to Production first' }, { status: 400 });
    }
    await execute(
      "UPDATE employees SET department = 'Production', trade = COALESCE(?, trade), active = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      [trade, Number(b.employee_id)]
    );
    await audit('worker_activated', { actor: user.username, detail: `#${b.employee_id}` });
    return NextResponse.json({ id: Number(b.employee_id) });
  }

  // Path 2: nobody matched the search — create a new person. Server-side duplicate guard (not just
  // a UI nicety): reject a near-certain repeat of a name already on the Production worker roster.
  const name = String(b.name || '').trim();
  if (!name) return NextResponse.json({ error: 'Worker name is required' }, { status: 400 });
  const dupe = await execute(
    "SELECT id FROM employees WHERE lower(name) = lower(?) AND department = 'Production' AND employee_type = 'worker'",
    [name]
  );
  if (dupe.rows?.length) {
    return NextResponse.json({ error: 'A Production worker with this name already exists — search for them instead' }, { status: 409 });
  }

  const seq = await nextCounterValue('employee_code', 1000);
  const employeeCode = `EMP-${seq}`;
  const { lastId } = await execute(
    `INSERT INTO employees (employee_code, name, employee_type, department, trade) VALUES (?, ?, 'worker', 'Production', ?)`,
    [employeeCode, name, trade]
  );
  await audit('worker_added', { actor: user.username, detail: `${employeeCode} · ${name}` });
  return NextResponse.json({ id: Number(lastId) });
}
