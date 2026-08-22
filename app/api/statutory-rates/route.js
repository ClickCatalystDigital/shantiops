// app/api/statutory-rates/route.js — single-row settings table (PF/ESI/PT/TDS/overtime rates).
// Stored as editable configuration, never hardcoded — these drift with law changes.
import { NextResponse } from 'next/server';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { getStatutoryRates, patchStatutoryRates } from '@/lib/payroll';
import { audit } from '@/lib/usb';

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
  try {
    await patchStatutoryRates(b);
    await audit('statutory_rates_updated', { actor: user.username, detail: Object.keys(b).join(', ') });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
