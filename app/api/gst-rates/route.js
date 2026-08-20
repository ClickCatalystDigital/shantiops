// app/api/gst-rates/route.js — HSN → GST rate master (ACCOUNTING-IMPLEMENTATION-PLAN.md Phase 1).
// Same add-only shape as app/api/professional-tax-slabs/route.js.
import { NextResponse } from 'next/server';
import { execute } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { getGstRates } from '@/lib/data';

export async function GET() {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Accounts');
  if (denied) return denied;
  return NextResponse.json(await getGstRates());
}

export async function POST(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Accounts');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Accounts', 'accounts.gst_rate.write');
  if (actionDenied) return actionDenied;
  const b = await req.json();
  if (!b.hsn_code || b.rate_pct == null || !b.effective_from) {
    return NextResponse.json({ error: 'hsn_code, rate_pct, effective_from are required' }, { status: 400 });
  }
  const { lastId } = await execute(
    'INSERT INTO gst_rates (hsn_code, description, rate_pct, effective_from, effective_to) VALUES (?, ?, ?, ?, ?)',
    [b.hsn_code, b.description ?? null, b.rate_pct, b.effective_from, b.effective_to ?? null]
  );
  return NextResponse.json({ id: Number(lastId) });
}
