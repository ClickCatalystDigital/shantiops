// Item Master number (IM-…) and Stores inventory number (INV-…) for a set of BOM lines — feeds the
// "Item No." column / chip on the Stores and Dispatch tables (components/ItemCodes.jsx).
// ponytail: one lookup keyed by bom_item id instead of a join in every list query; move the join
// into a query if one screen ever needs to sort or page by these numbers server-side.
import { NextResponse } from 'next/server';
import { getFreshSessionUser, isInternal } from '@/lib/auth';
import { queryAll } from '@/lib/db';

export async function POST(req) {
  const user = await getFreshSessionUser();
  if (!isInternal(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const ids = [...new Set((Array.isArray(body.ids) ? body.ids : []).map(Number).filter(Number.isInteger))].slice(0, 5000);
  const out = {};
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const rows = await queryAll(
      `SELECT b.id, it.item_code AS item,
              COALESCE((SELECT item_code FROM inventory_items WHERE id = b.inventory_item_id),
                       (SELECT MIN(item_code) FROM inventory_items WHERE item_id = b.item_id AND b.item_id IS NOT NULL)) AS inv
         FROM bom_items b LEFT JOIN items it ON it.id = b.item_id
        WHERE b.id IN (${chunk.map(() => '?').join(',')})`, chunk);
    for (const r of rows) if (r.item || r.inv) out[r.id] = { item: r.item || null, inv: r.inv || null };
  }
  return NextResponse.json(out);
}
