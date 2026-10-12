// app/api/settings/sales-retention/route.js — the Sales history retention window (off by default).
// Sales Head or a PM sets it; nothing is deleted by changing it (see lib/sales-retention.js).
import { NextResponse } from 'next/server';
import { getFreshSessionUser, isDepartmentHead } from '@/lib/auth';
import { getRetention, setRetention } from '@/lib/sales-retention';

const denied = user => (!isDepartmentHead(user, 'Sales') ? NextResponse.json({ error: 'Only a Sales Head can manage data retention' }, { status: 403 }) : null);

export async function GET() {
  const user = await getFreshSessionUser();
  return denied(user) || NextResponse.json(await getRetention());
}

export async function PATCH(req) {
  const user = await getFreshSessionUser();
  const d = denied(user); if (d) return d;
  try { return NextResponse.json(await setRetention(await req.json(), user.username)); }
  catch (err) { return NextResponse.json({ error: err.message }, { status: 400 }); }
}
