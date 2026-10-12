// app/api/gst-rates/route.js — HSN → GST rate master (ACCOUNTING-IMPLEMENTATION-PLAN.md Phase 1).
// Same add-only shape as app/api/professional-tax-slabs/route.js.
import { NextResponse } from 'next/server';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { getGstRates, insertGstRate } from '@/lib/data';
import { audit } from '@/lib/usb';

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
  try {
    const id = await insertGstRate(b);
    await audit('gst_rate_added', { actor: user.username, detail: `${b.hsn_code} @ ${b.rate_pct}% from ${b.effective_from}` });
    return NextResponse.json({ id });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
