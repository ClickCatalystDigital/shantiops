// app/api/income-tax-slabs/route.js — new-regime TDS slabs only (old regime out of scope).
// Seeded with today's best-known figures; must stay editable since tax law changes yearly.
import { NextResponse } from 'next/server';
import { execute } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { getIncomeTaxSlabs } from '@/lib/data';

export async function GET() {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'HR');
  if (denied) return denied;
  return NextResponse.json(await getIncomeTaxSlabs());
}

export async function POST(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'HR');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'HR', 'hr.statutory.write');
  if (actionDenied) return actionDenied;
  const b = await req.json();
  if (!b.financial_year || b.min_income == null || b.rate_pct == null) {
    return NextResponse.json({ error: 'financial_year, min_income, rate_pct are required' }, { status: 400 });
  }
  const { lastId } = await execute(
    "INSERT INTO income_tax_slabs (regime, financial_year, min_income, max_income, rate_pct) VALUES ('new', ?, ?, ?, ?)",
    [b.financial_year, b.min_income, b.max_income ?? null, b.rate_pct]
  );
  return NextResponse.json({ id: Number(lastId) });
}
