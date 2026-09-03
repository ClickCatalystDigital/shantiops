// app/api/where-used/route.js — STERP item 17, Where-Used List (SYSTEM.md §5o). Read-only,
// same isInternal-only gate as app/api/sales-returns' GET (this is oversight data, not any one
// department's own record).
import { NextResponse } from 'next/server';
import { getFreshSessionUser, isInternal } from '@/lib/auth';
import { getWhereUsed } from '@/lib/data';

export async function GET(req) {
  const user = await getFreshSessionUser();
  if (!isInternal(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const sp = new URL(req.url).searchParams;
  const q = sp.get('q');
  // round 3 Phase A — Engineering's shared multi-select project filter, optional (CSV of ids).
  const projectIdsParam = sp.get('project_ids');
  const projectIds = projectIdsParam ? projectIdsParam.split(',').map(Number).filter(Boolean) : undefined;
  return NextResponse.json(await getWhereUsed(q, projectIds));
}
