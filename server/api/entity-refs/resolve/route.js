// app/api/entity-refs/resolve/route.js — batched code -> entity resolution for LinkifiedText.jsx.
// isInternal-only at this layer, same as app/api/inventory-items/lookup-code/route.js (project
// artifacts were verified during planning to never be department-siloed for reads). Procurement/
// Sales/Accounts/Dispatch's own documents ARE department-gated, though — same as their normal
// workspace — enforced per-prefix inside lib/entity-refs.js's READ_GATE, not here, so `user` is
// passed through rather than re-checked at this layer.
import { NextResponse } from 'next/server';
import { getFreshSessionUser, isInternal } from '@/lib/auth';
import { resolveEntityRefs } from '@/lib/entity-refs';

export async function GET(req) {
  const user = await getFreshSessionUser();
  if (!isInternal(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const codes = (new URL(req.url).searchParams.get('codes') || '').split(',').map(c => c.trim()).filter(Boolean);
  const refs = await resolveEntityRefs(codes, user);
  return NextResponse.json({ refs });
}
