// app/api/entity-refs/related/route.js — given one already-resolved entity (type+id), returns its
// structural relations (RELATIONS table, lib/entity-refs.js) for RelatedItemsCard.jsx. Same
// isInternal-only shape as resolve/route.js — per-relation department gating happens inside
// getRelatedEntities() via resolveEntityRefs()'s existing READ_GATE, not here.
import { NextResponse } from 'next/server';
import { getFreshSessionUser, isInternal } from '@/lib/auth';
import { getRelatedEntities } from '@/lib/entity-refs';

export async function GET(req) {
  const user = await getFreshSessionUser();
  if (!isInternal(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const sp = new URL(req.url).searchParams;
  const type = sp.get('type');
  const id = Number(sp.get('id'));
  if (!type || !id) return NextResponse.json({ groups: [] });
  const groups = await getRelatedEntities(type, id, user);
  return NextResponse.json({ groups });
}
