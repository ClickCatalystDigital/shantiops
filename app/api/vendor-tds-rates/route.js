// app/api/vendor-tds-rates/route.js — vendor TDS section/rate master (ACCOUNTING-IMPLEMENTATION-
// PLAN.md Phase 1). Rate table only — no per-vendor cumulative threshold tracking (Phase 3).
import { NextResponse } from 'next/server';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { getVendorTdsRates, insertVendorTdsRate } from '@/lib/data';
import { audit } from '@/lib/usb';

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
  try {
    const id = await insertVendorTdsRate(b);
    await audit('vendor_tds_rate_added', { actor: user.username, detail: `${b.section} @ ${b.rate_pct}% from ${b.effective_from}` });
    return NextResponse.json({ id });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
