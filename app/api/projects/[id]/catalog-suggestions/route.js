import { NextResponse } from 'next/server';
import { queryAll } from '@/lib/db';
import { getFreshSessionUser } from '@/lib/auth';
import { requireEngineeringAction } from '@/lib/action-permissions';
import { matchLines, linkBomItem } from '@/lib/item-link';
import { fillUnitFromCatalog } from '@/lib/item-match.mjs';

// Review queue for BOM lines that are not linked to the Item Master yet (imported before matching existed, or nothing matched at
// import). GET: every unlinked line of the project with its best match (lib/item-match.mjs). POST {links:[{bom_item_id,item_id}]}:
// link the ones a person accepted — each goes through linkBomItem, so it is remembered for next time and any bare quantity picks
// up the catalog unit. Nothing here links anything by itself; 'auto' matches are only pre-ticked in the UI.
const LINE_COLS = 'id, material_description, moc, size_spec, qty_text, category';

export async function GET(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = await requireEngineeringAction(user, 'engineering.bom.link_item');
  if (denied) return denied;
  const items = await queryAll(
    `SELECT ${LINE_COLS} FROM bom_items WHERE project_id = ? AND item_id IS NULL AND source = 'bom' ORDER BY sort_order, id`, [params.id]);
  const matches = await matchLines(items);
  const out = items.map((it, i) => {
    const m = matches[i];
    const chosen = m.itemId ? m.candidates.find(c => c.id === m.itemId) : null;
    return {
      id: it.id, description: it.material_description, moc: it.moc, size_spec: it.size_spec, qty_text: it.qty_text, category: it.category,
      level: m.level, reason: m.reason, itemId: m.itemId || null, itemName: chosen?.name || null,
      unitAfter: chosen ? fillUnitFromCatalog(it.qty_text, chosen.uom, it.category) : null,
      candidates: m.candidates,
    };
  });
  // Most useful first: confident matches, then suggestions, then the rest.
  const rank = { memory: 0, family: 0, attribute: 0, suggest: 1, none: 2 };
  out.sort((a, b) => rank[a.level] - rank[b.level]);
  return NextResponse.json({ items: out, counts: { auto: out.filter(o => o.itemId).length, suggest: out.filter(o => o.level === 'suggest').length, none: out.filter(o => o.level === 'none').length } });
}

export async function POST(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = await requireEngineeringAction(user, 'engineering.bom.link_item');
  if (denied) return denied;
  const b = await req.json().catch(() => ({}));
  const links = Array.isArray(b.links) ? b.links.slice(0, 50) : []; // the UI sends small batches: each link is several database writes
  if (!links.length) return NextResponse.json({ error: 'Nothing to link' }, { status: 400 });
  const mine = new Set((await queryAll('SELECT id FROM bom_items WHERE project_id = ?', [params.id])).map(r => r.id));
  let linked = 0, unitsFilled = 0;
  const skipped = [];
  for (const l of links) {
    const id = Number(l.bom_item_id), itemId = Number(l.item_id);
    if (!mine.has(id) || !Number.isInteger(itemId)) { skipped.push({ id, reason: 'Not a line of this project' }); continue; }
    const r = await linkBomItem(id, itemId, user.username);
    if (r.error) skipped.push({ id, reason: r.error });
    else { linked++; if (r.unitFilled) unitsFilled++; }
  }
  return NextResponse.json({ linked, unitsFilled, skipped });
}
