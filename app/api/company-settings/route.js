// app/api/company-settings/route.js — one row per legal entity (ACCOUNTING-IMPLEMENTATION-PLAN.md
// Phase 0). Same shape as app/api/statutory-rates/route.js, keyed by row id instead of singleton.
import { NextResponse } from 'next/server';
import { execute } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { getCompanySettings } from '@/lib/data';

export async function GET() {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Accounts');
  if (denied) return denied;
  return NextResponse.json(await getCompanySettings());
}

export async function PATCH(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Accounts');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Accounts', 'accounts.company_settings.write');
  if (actionDenied) return actionDenied;
  const b = await req.json();
  if (!b.id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const fields = [];
  const args = [];
  for (const key of ['legal_name', 'gstin', 'pan', 'registered_address', 'state', 'state_code', 'invoice_prefix']) {
    if (b[key] !== undefined) { fields.push(`${key} = ?`); args.push(b[key]); }
  }
  if (!fields.length) return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  args.push(b.id);
  await execute(`UPDATE company_settings SET ${fields.join(', ')} WHERE id = ?`, args);
  return NextResponse.json({ ok: true });
}
