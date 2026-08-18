import { NextResponse } from 'next/server';
import { execute } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { getProfessionalTaxSlabs } from '@/lib/data';

export async function GET() {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'HR');
  if (denied) return denied;
  return NextResponse.json(await getProfessionalTaxSlabs());
}

export async function POST(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'HR');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'HR', 'hr.statutory.write');
  if (actionDenied) return actionDenied;
  const b = await req.json();
  if (!b.state || b.min_gross == null || b.amount == null) {
    return NextResponse.json({ error: 'state, min_gross, amount are required' }, { status: 400 });
  }
  const { lastId } = await execute(
    'INSERT INTO professional_tax_slabs (state, min_gross, max_gross, amount) VALUES (?, ?, ?, ?)',
    [b.state, b.min_gross, b.max_gross ?? null, b.amount]
  );
  return NextResponse.json({ id: Number(lastId) });
}
