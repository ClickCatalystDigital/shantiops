// app/api/entity-refs/resolve/route.js — batched code -> entity resolution for LinkifiedText.jsx.
// Same auth posture as app/api/inventory-items/lookup-code/route.js (isInternal-only, no added
// department/project scoping — verified during planning that reading project data was never
// department-siloed in this app; canAccessDepartment gates actions, not reads).
import { NextResponse } from 'next/server';
import { getFreshSessionUser, isInternal } from '@/lib/auth';
import { resolveEntityRefs } from '@/lib/entity-refs';

export async function GET(req) {
  const user = await getFreshSessionUser();
  if (!isInternal(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const codes = (new URL(req.url).searchParams.get('codes') || '').split(',').map(c => c.trim()).filter(Boolean);
  const refs = await resolveEntityRefs(codes);
  return NextResponse.json({ refs });
}
