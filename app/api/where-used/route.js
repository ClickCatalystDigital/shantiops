// app/api/where-used/route.js — STERP item 17, Where-Used List (SYSTEM.md §5o). Read-only,
// same isInternal-only gate as app/api/sales-returns' GET (this is oversight data, not any one
// department's own record).
import { NextResponse } from 'next/server';
import { getFreshSessionUser, isInternal } from '@/lib/auth';
import { getWhereUsed } from '@/lib/data';

export async function GET(req) {
  const user = await getFreshSessionUser();
  if (!isInternal(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const q = new URL(req.url).searchParams.get('q');
  return NextResponse.json(await getWhereUsed(q));
}
