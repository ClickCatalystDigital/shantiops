// Multi-unit BOM split, Phase 3 (MULTI-UNIT-SPLIT-DESIGN.md §5.1) — read-only derived per-unit BOM
// for a child project. Never returns anything a child project doesn't itself derive from its master
// live; a plain (non-split) project just gets { isChild: false }. Any internal user can view — this
// is a read surface, not a write action, matching this app's convention for BOM read routes.
import { NextResponse } from 'next/server';
import { getFreshSessionUser, isInternal } from '@/lib/auth';
import { getChildDerivedBom } from '@/lib/data';

export async function GET(req, { params }) {
  const user = await getFreshSessionUser();
  if (!isInternal(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const derived = await getChildDerivedBom(params.id);
  if (!derived) return NextResponse.json({ isChild: false });
  return NextResponse.json({ isChild: true, ...derived });
}
