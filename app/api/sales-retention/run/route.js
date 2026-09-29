import { NextResponse } from 'next/server';
import { getFreshSessionUser, isDepartmentHead } from '@/lib/auth';
import { runRetention } from '@/lib/sales-retention';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(req) {
  const user = await getFreshSessionUser();
  if (!isDepartmentHead(user, 'Sales')) return NextResponse.json({ error: 'Only a Sales Head can manage data retention' }, { status: 403 });
  if ((await req.json().catch(() => ({}))).confirm !== true) return NextResponse.json({ error: 'Confirmation required' }, { status: 400 });
  try { return NextResponse.json(await runRetention(user.username)); }
  catch (err) { return NextResponse.json({ error: err.message }, { status: 400 }); }
}
