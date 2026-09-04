// app/api/projects/[id]/costing/route.js — STERP "Sales Costing" (SYSTEM.md §5e), post-sale only.
// Read-only, isInternal-gated same as most cost-adjacent reads in this app (e.g. Vendor Analysis) —
// margin visibility across departments isn't a Sales-only concern.
import { NextResponse } from 'next/server';
import { getFreshSessionUser, isInternal } from '@/lib/auth';
import { getProjectCosting } from '@/lib/data';

export async function GET(req, { params }) {
  const user = await getFreshSessionUser();
  if (!isInternal(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const costing = await getProjectCosting(params.id);
  // A split child has no commercial value of its own — see getProjectCosting's own comment.
  if (costing.isChild) {
    return NextResponse.json({ error: 'This is one unit of a multi-unit order — costing is tracked on the master project only.' }, { status: 400 });
  }
  return NextResponse.json(costing);
}
