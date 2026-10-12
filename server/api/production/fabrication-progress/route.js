// Job-card completion per milestone for one project (§3.4) — the rollup that makes job cards worth
// entering. Correct by construction since job cards are milestone-scoped (§3.1), not name-matched.
import { NextResponse } from 'next/server';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { getFabricationProgress } from '@/lib/data';

export async function GET(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Production');
  if (denied) return denied;
  const projectId = new URL(req.url).searchParams.get('project_id');
  if (!projectId) return NextResponse.json({ error: 'project_id is required' }, { status: 400 });
  return NextResponse.json(await getFabricationProgress(projectId));
}
