// Multi-unit BOM split, Phase 4 (MULTI-UNIT-SPLIT-DESIGN.md §5.2) — the Stores pipeline view for one
// (master) project: per BOM line, received/allocated/available, plus the project's own child units
// to allocate against (reuses the split route's own children query — same shape, no second source
// of truth for "who are this master's children").
import { NextResponse } from 'next/server';
import { getFreshSessionUser, isInternal } from '@/lib/auth';
import { queryAll } from '@/lib/db';
import { getProjectAllocationSummary } from '@/lib/data';

export async function GET(req, { params }) {
  const user = await getFreshSessionUser();
  if (!isInternal(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const [lines, children] = await Promise.all([
    getProjectAllocationSummary(params.id),
    queryAll('SELECT id, project_no, unit_no FROM projects WHERE master_project_id = ? ORDER BY unit_no', [params.id]),
  ]);
  return NextResponse.json({ lines, children });
}
