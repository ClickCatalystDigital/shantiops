// app/api/vendor-tds-rates/route.js — vendor TDS section/rate master (ACCOUNTING-IMPLEMENTATION-
// PLAN.md Phase 1). Rate table only — no per-vendor cumulative threshold tracking (Phase 3).
import { NextResponse } from 'next/server';
import { execute } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { getVendorTdsRates } from '@/lib/data';

export async function GET() {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Accounts');
  if (denied) return denied;
  return NextResponse.json(await getVendorTdsRates());
}

export async function POST(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Accounts');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Accounts', 'accounts.tds_rate.write');
  if (actionDenied) return actionDenied;
  const b = await req.json();
  if (!b.section || b.rate_pct == null || !b.effective_from) {
    return NextResponse.json({ error: 'section, rate_pct, effective_from are required' }, { status: 400 });
  }
  const { lastId } = await execute(
    'INSERT INTO vendor_tds_rates (section, description, rate_pct, threshold_amount, effective_from, effective_to) VALUES (?, ?, ?, ?, ?, ?)',
    [b.section, b.description ?? null, b.rate_pct, b.threshold_amount ?? null, b.effective_from, b.effective_to ?? null]
  );
  return NextResponse.json({ id: Number(lastId) });
}
