// app/api/projects/[id]/design-signoff/route.js — Project View redesign, Decision F. The "Approve
// Design" workflow's new home is /engineering, not the unified Project View (which only shows a
// read-only badge now). This is a small, dedicated read endpoint for that one milestone — the
// actual write still goes through the existing, unmodified PATCH /api/milestones/[id] route.
import { NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import { getFreshSessionUser, isInternal } from '@/lib/auth';

export async function GET(req, { params }) {
  const user = await getFreshSessionUser();
  if (!isInternal(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const m = await queryOne(
    "SELECT id, status, actual_end FROM milestones WHERE project_id = ? AND milestone_key = 'design'",
    [params.id]);
  if (!m) return NextResponse.json({ error: 'No Design milestone on this project' }, { status: 404 });
  return NextResponse.json({ milestoneId: m.id, done: !!(m.actual_end || m.status === 'done') });
}
