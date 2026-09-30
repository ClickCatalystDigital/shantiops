// Stores -> Demand: per-project roll-up of the Material Plan. Same department gate as /api/plan; lines
// for one project come from GET /api/plan?project_ids=<id> when a card is expanded.
import { NextResponse } from 'next/server';
import { getFreshSessionUser, canAccessDepartment } from '@/lib/auth';
import { getProjectPlanSummaries } from '@/lib/plan-coverage';

export async function GET(req) {
  const user = await getFreshSessionUser();
  if (!['Production', 'Stores', 'Procurement'].some(d => canAccessDepartment(user, d))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const within = Number(new URL(req.url).searchParams.get('within'));
  return NextResponse.json(await getProjectPlanSummaries({ withinDays: Number.isFinite(within) && within >= 0 ? within : 14 }));
}
