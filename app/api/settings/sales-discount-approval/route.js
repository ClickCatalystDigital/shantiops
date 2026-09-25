// app/api/settings/sales-discount-approval/route.js — Sales CRM plan 4. The line discount % above
// which a quotation needs a Sales Head's approval. Anyone internal can read it; a Head sets it.
import { NextResponse } from 'next/server';
import { getAppSetting, setAppSetting } from '@/lib/db';
import { getFreshSessionUser, isInternal, isDepartmentHead } from '@/lib/auth';
import { DEFAULT_DISCOUNT_APPROVAL_PCT } from '@/lib/quotation-approval.mjs';
import { audit } from '@/lib/usb';

const KEY = 'sales_discount_approval_pct';

export async function GET() {
  const user = await getFreshSessionUser();
  if (!isInternal(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  return NextResponse.json({ pct: Number(await getAppSetting(KEY, String(DEFAULT_DISCOUNT_APPROVAL_PCT))) });
}

export async function PATCH(req) {
  const user = await getFreshSessionUser();
  if (!isDepartmentHead(user, 'Sales')) return NextResponse.json({ error: 'Only a Sales Head can change this' }, { status: 403 });
  const pct = Number((await req.json()).pct);
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) return NextResponse.json({ error: 'Enter a % from 0 to 100' }, { status: 400 });
  const before = await getAppSetting(KEY, String(DEFAULT_DISCOUNT_APPROVAL_PCT));
  await setAppSetting(KEY, String(pct));
  await audit('sales_discount_approval_pct', { actor: user.username, detail: `${before}% → ${pct}%` });
  return NextResponse.json({ ok: true, pct });
}
