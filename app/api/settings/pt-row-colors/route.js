// Order Tracker row colours + rules, saved per user (app_settings key pt_row_colors:<username>).
import { NextResponse } from 'next/server';
import { getAppSetting, setAppSetting } from '@/lib/db';
import { getFreshSessionUser, isInternal } from '@/lib/auth';
import { normalizeRowSettings } from '@/lib/order-match.mjs';

const key = u => `pt_row_colors:${u.username}`;

export async function GET() {
  const user = await getFreshSessionUser();
  if (!isInternal(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  let raw = null;
  try { raw = JSON.parse(await getAppSetting(key(user), 'null')); } catch { /* fall back to defaults */ }
  return NextResponse.json(normalizeRowSettings(raw));
}

export async function PUT(req) {
  const user = await getFreshSessionUser();
  if (!isInternal(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const clean = normalizeRowSettings(await req.json());
  await setAppSetting(key(user), JSON.stringify(clean));
  return NextResponse.json(clean);
}
