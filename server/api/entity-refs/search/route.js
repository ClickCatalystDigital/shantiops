// app/api/entity-refs/search/route.js — backs MentionTextarea.jsx's "@" reference search.
// Same isInternal-only gate as .../entity-refs/resolve and .../inventory-items/lookup-code at this
// layer; per-type department gating (Procurement/Sales/Accounts/Dispatch documents) lives inside
// lib/entity-refs.js's SEARCH_GATE — without it this endpoint would be an active browse-by-typing
// side door into those documents for a user who can't open the matching workspace at all.
import { NextResponse } from 'next/server';
import { getFreshSessionUser, isInternal } from '@/lib/auth';
import { searchEntityRefs, ENTITY_TYPES } from '@/lib/entity-refs';

export async function GET(req) {
  const user = await getFreshSessionUser();
  if (!isInternal(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const params = new URL(req.url).searchParams;
  const type = params.get('type');
  if (!ENTITY_TYPES.some(t => t.type === type)) return NextResponse.json({ error: 'Unknown type' }, { status: 400 });
  const results = await searchEntityRefs(type, params.get('q'), user);
  return NextResponse.json({ results });
}
