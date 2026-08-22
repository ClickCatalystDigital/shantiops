// app/api/company-period-lock/route.js — one lock date per company. Enforced centrally in
// lib/ledger-post.js (every journal posting funnels through insertEntryWithLines()), this route is
// only for reading/setting the date.
import { NextResponse } from 'next/server';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { getPeriodLock, setPeriodLock } from '@/lib/period-lock';
import { audit } from '@/lib/usb';
import { COMPANY_NAMES } from '@/lib/qc-doc-pdf.js';

export async function GET(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Accounts');
  if (denied) return denied;
  const { searchParams } = new URL(req.url);
  const company = COMPANY_NAMES.includes(searchParams.get('company')) ? searchParams.get('company') : COMPANY_NAMES[0];
  return NextResponse.json((await getPeriodLock(company)) ?? { company, locked_through: null });
}

export async function PATCH(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Accounts');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Accounts', 'accounts.period_lock.write');
  if (actionDenied) return actionDenied;
  const b = await req.json();
  const company = COMPANY_NAMES.includes(b.company) ? b.company : COMPANY_NAMES[0];
  if (!b.locked_through) return NextResponse.json({ error: 'locked_through is required' }, { status: 400 });
  await setPeriodLock(company, b.locked_through, user.username);
  await audit('period_lock_updated', { actor: user.username, detail: `${company} locked through ${b.locked_through}` });
  return NextResponse.json({ ok: true });
}
