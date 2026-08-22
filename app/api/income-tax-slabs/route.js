// app/api/income-tax-slabs/route.js — new-regime TDS slabs only (old regime out of scope).
// Seeded with today's best-known figures; must stay editable since tax law changes yearly.
import { NextResponse } from 'next/server';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { getIncomeTaxSlabs, insertIncomeTaxSlab } from '@/lib/data';
import { audit } from '@/lib/usb';

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
  try {
    const id = await insertIncomeTaxSlab(b);
    await audit('income_tax_slab_added', { actor: user.username, detail: `FY ${b.financial_year}: ${b.min_income}+ @ ${b.rate_pct}%` });
    return NextResponse.json({ id });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
