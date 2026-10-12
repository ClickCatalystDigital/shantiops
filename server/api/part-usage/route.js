// app/api/part-usage/route.js — Common/Uncommon List (STERP item 18, SYSTEM.md §5o). Same shape as
// app/api/where-used/route.js — read-only, isInternal-only gate (oversight data, not any one
// department's own record). Round 3 Phase A: CommonUncommonTab moved from a static server-fetched
// `partUsage` prop to client-fetching this route, so Engineering's shared multi-select project
// filter can genuinely recompute project_count/classification against a scoped subset, not just
// hide rows client-side.
import { NextResponse } from 'next/server';
import { getFreshSessionUser, isInternal } from '@/lib/auth';
import { getPartUsage } from '@/lib/data';

export async function GET(req) {
  const user = await getFreshSessionUser();
  if (!isInternal(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const projectIdsParam = new URL(req.url).searchParams.get('project_ids');
  const projectIds = projectIdsParam ? projectIdsParam.split(',').map(Number).filter(Boolean) : undefined;
  return NextResponse.json(await getPartUsage(projectIds));
}
