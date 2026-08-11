// app/api/payroll-runs/route.js — HR completion bundle. POST generates one salary_slip per active
// employee with an active salary_structure_assignment covering the period, via
// lib/payroll.js's generateSalarySlip (the one persistence entrypoint every generation path uses).
import { NextResponse } from 'next/server';
import { execute, queryAll } from '@/lib/db';
import { getSessionUser, requireDepartment } from '@/lib/auth';
import { getPayrollRuns } from '@/lib/data';
import { generateSalarySlip } from '@/lib/payroll';
import { audit } from '@/lib/usb';

export async function GET() {
  const user = getSessionUser();
  const denied = requireDepartment(user, 'HR');
  if (denied) return denied;
  return NextResponse.json(await getPayrollRuns());
}

export async function POST(req) {
  const user = getSessionUser();
  const denied = requireDepartment(user, 'HR');
  if (denied) return denied;
  const b = await req.json();
  const periodMonth = Number(b.period_month);
  const periodYear = Number(b.period_year);
  if (!periodMonth || !periodYear) return NextResponse.json({ error: 'period_month and period_year are required' }, { status: 400 });

  const lastDay = new Date(periodYear, periodMonth, 0).getDate();
  const fromDate = `${periodYear}-${String(periodMonth).padStart(2, '0')}-01`;
  const toDate = `${periodYear}-${String(periodMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

  const { lastId: runId } = await execute(
    `INSERT INTO payroll_runs (period_month, period_year, from_date, to_date, status, created_by)
     VALUES (?, ?, ?, ?, 'processed', ?)`,
    [periodMonth, periodYear, fromDate, toDate, user.username]
  );

  const eligible = await queryAll(
    `SELECT DISTINCT e.id FROM employees e
       JOIN salary_structure_assignments ssa ON ssa.employee_id = e.id AND ssa.active = 1 AND ssa.from_date <= ?
      WHERE e.active = 1`,
    [toDate]
  );

  const results = [];
  const errors = [];
  for (const row of eligible) {
    try {
      const res = await generateSalarySlip(row.id, periodMonth, periodYear, { payrollRunId: Number(runId), createdBy: user.username });
      results.push(res);
    } catch (err) {
      errors.push({ employee_id: row.id, error: err.message });
    }
  }
  await execute("UPDATE payroll_runs SET processed_at = CURRENT_TIMESTAMP WHERE id = ?", [runId]);
  await audit('payroll_run_processed', { actor: user.username, detail: `run #${runId}, ${results.length} slips, ${errors.length} errors` });
  return NextResponse.json({ id: Number(runId), generated: results.length, errors });
}
