// Multi-unit split — read-only routing board for a MASTER project: which (BOM line, child unit)
// pairs are allocation-ready, and where Stores has routed each one (Production/Dispatch/undecided).
// Feeds both ChildRoutingPanel (Stores' write UI) and, indirectly via getChildRoutingBoard being the
// one shared function, POST /api/packing/batch-children's own gate. Any internal user can view — a
// read surface, matching child-bom/allocation-summary's own convention.
import { NextResponse } from 'next/server';
import { getFreshSessionUser, isInternal } from '@/lib/auth';
import { getChildRoutingBoard } from '@/lib/data';

export async function GET(req, { params }) {
  const user = await getFreshSessionUser();
  if (!isInternal(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const board = await getChildRoutingBoard(params.id);
  return NextResponse.json(board);
}
