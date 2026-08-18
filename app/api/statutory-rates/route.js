// app/api/statutory-rates/route.js — single-row settings table (PF/ESI/PT/TDS/overtime rates).
// Stored as editable configuration, never hardcoded — these drift with law changes.
import { NextResponse } from 'next/server';
import { execute } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { getStatutoryRates } from '@/lib/payroll';

export async function GET() {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'HR');
  if (denied) return denied;
  return NextResponse.json(await getStatutoryRates());
}

export async function PATCH(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'HR');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'HR', 'hr.statutory.write');
  if (actionDenied) return actionDenied;
  const b = await req.json();
  const fields = [];
  const args = [];
  for (const key of ['pf_employee_pct', 'pf_employer_pct', 'pf_wage_ceiling', 'apply_pf_ceiling',
    'esi_employee_pct', 'esi_employer_pct', 'esi_wage_ceiling', 'standard_monthly_hours',
    'overtime_multiplier', 'standard_deduction', 'tds_rebate_income_threshold']) {
    if (b[key] !== undefined) { fields.push(`${key} = ?`); args.push(b[key]); }
  }
  if (!fields.length) return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  fields.push('updated_at = CURRENT_TIMESTAMP');
  const current = await getStatutoryRates();
  args.push(current.id);
  await execute(`UPDATE statutory_rates SET ${fields.join(', ')} WHERE id = ?`, args);
  return NextResponse.json({ ok: true });
}
