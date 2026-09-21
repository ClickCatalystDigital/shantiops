import { NextResponse } from 'next/server';
import { getFreshSessionUser } from '@/lib/auth';
import { requireEngineeringAction } from '@/lib/action-permissions';
import { linkBomItem } from '@/lib/item-link';

// Dedicated endpoint, deliberately not routed through the generic PATCH (app/api/bom-items/[id]/
// route.js) or BOM_FIELD_OWNERS — that machinery treats every field as opaque string/trim with no
// FK check, which would silently write a string into this INTEGER FK and skip the history guard.
// The guard, the write, the audit and the "remember this link" learning all live in lib/item-link.js
// (linkBomItem), shared with the review queue, so a human link is handled identically everywhere.
export async function POST(req, { params }) {
  const user = await getFreshSessionUser();
  const actionDenied = await requireEngineeringAction(user, 'engineering.bom.link_item');
  if (actionDenied) return actionDenied;
  const b = await req.json();
  const r = await linkBomItem(params.id, b.item_id, user.username);
  if (r.error) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json({ ok: true, unit_filled: r.unitFilled });
}
