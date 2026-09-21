import { NextResponse } from 'next/server';
import { queryOne, queryAll, withTransaction } from '@/lib/db';
import { getFreshSessionUser } from '@/lib/auth';
import { requireEngineeringAction } from '@/lib/action-permissions';
import { findBlockedIds } from '@/lib/bom-item-guard';
import { splitVariants } from '@/lib/multi-value.mjs';
import { audit } from '@/lib/usb';

// "Split multi-value items" — a BOM item imported before multi-value cells were split, where ONE row holds several
// sizes and quantities ("88 No / 58 No" beside two sizes). Human-triggered per node, never automatic. Each item becomes
// one row per value (lib/multi-value.mjs — the same rule the importer now applies): the original row keeps its id and
// becomes value #1, the others are copies of it with their own size / quantity (and MOC/make when those line up).
// Refused, with a reason, for anything that could not be safely rewritten: a released BOM, a Purchase-Request-raised
// line, an item with quotes/orders/receipts or other downstream activity (lib/bom-item-guard.js — the gate single-item
// delete and PMB Replace use), or a line with structured dimensions (category_fields_json). Nothing is split unless the
// size cell has exactly as many segments as the quantity cell has quantities.
const COLS = `id, material_description, moc, size_spec, make, remarks, qty_text, pr_item_id, category_fields_json`;

async function loadCandidates(node) {
  const milestone = await queryOne(
    `SELECT status, actual_end FROM milestones WHERE project_id = ? AND milestone_key = 'release_bom'`, [node.project_id]);
  const released = !!(milestone?.actual_end || milestone?.status === 'done');
  const items = await queryAll(`SELECT ${COLS} FROM bom_items WHERE assembly_id = ? ORDER BY sort_order, id`, [node.id]);
  const parsed = items.map(it => ({ it, variants: splitVariants(it) })).filter(x => x.variants);
  const blocked = await findBlockedIds(parsed.map(x => x.it.id));
  return parsed.map(({ it, variants }) => {
    let reason = null;
    if (released) reason = 'This BOM has been released';
    else if (it.pr_item_id != null) reason = 'Raised through a Purchase Request';
    else if (it.category_fields_json) reason = 'Has structured dimensions';
    else if (blocked.has(it.id)) reason = 'Has quotes, orders, receipts or other activity';
    return {
      id: it.id, description: it.material_description, parts: variants.length,
      quantities: variants.map(v => v.qty_text), convertible: !reason, reason, variants,
    };
  });
}

const loadNode = id => queryOne('SELECT id, project_id, name FROM bom_assemblies WHERE id = ?', [id]);

export async function GET(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = await requireEngineeringAction(user, 'engineering.bom.add_item');
  if (denied) return denied;
  const node = await loadNode(params.id);
  if (!node) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const candidates = (await loadCandidates(node)).map(({ variants, ...c }) => c);
  return NextResponse.json({ candidates });
}

export async function POST(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = await requireEngineeringAction(user, 'engineering.bom.add_item');
  if (denied) return denied;
  const node = await loadNode(params.id);
  if (!node) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const b = await req.json().catch(() => ({}));
  const candidates = await loadCandidates(node);
  const byId = new Map(candidates.map(c => [c.id, c]));
  const wanted = Array.isArray(b.item_ids)
    ? [...new Set(b.item_ids.map(Number).filter(Number.isInteger))]
    : candidates.filter(c => c.convertible).map(c => c.id);
  if (!wanted.length) return NextResponse.json({ error: 'Nothing to split' }, { status: 400 });
  if (wanted.length > 100) return NextResponse.json({ error: 'Split at most 100 items at a time' }, { status: 400 });

  const skipped = [];
  const eligible = [];
  for (const id of wanted) {
    const c = byId.get(id);
    if (!c) skipped.push({ id, reason: 'Not a multi-value item on this node (sizes and quantities do not line up)' });
    else if (!c.convertible) skipped.push({ id, description: c.description, reason: c.reason });
    else eligible.push(c);
  }
  if (!eligible.length) return NextResponse.json({ split: 0, created: 0, skipped });

  // Copy every column of the original row except its id, so a new row carries the same category, catalog link,
  // traceability flags, import lineage etc. — then overwrite just the values that differ.
  const cols = (await queryAll('PRAGMA table_info(bom_items)')).map(c => c.name).filter(n => n !== 'id');
  const colList = cols.map(c => `"${c}"`).join(', ');
  let created = 0;
  await withTransaction(async tx => {
    for (const c of eligible) {
      const [first, ...rest] = c.variants;
      const setValues = v => [v.size_spec ?? null, v.qty_text ?? null, v.moc ?? null, v.make ?? null, v.remarks ?? null];
      await tx.execute({ sql: 'UPDATE bom_items SET size_spec = ?, qty_text = ?, moc = ?, make = ?, remarks = ? WHERE id = ?', args: [...setValues(first), c.id] });
      for (const v of rest) {
        const ins = await tx.execute({ sql: `INSERT INTO bom_items (${colList}) SELECT ${colList} FROM bom_items WHERE id = ?`, args: [c.id] });
        await tx.execute({ sql: 'UPDATE bom_items SET size_spec = ?, qty_text = ?, moc = ?, make = ?, remarks = ? WHERE id = ?', args: [...setValues(v), Number(ins.lastInsertRowid)] });
        created++;
      }
    }
  });

  await audit('bom_items_split_multi_value', {
    actor: user.username,
    detail: JSON.stringify({
      project_id: node.project_id, node_id: node.id, node: node.name, created,
      split: eligible.map(c => ({ id: c.id, description: c.description, quantities: c.quantities })), skipped: skipped.length,
    }),
  });
  return NextResponse.json({ split: eligible.length, created, skipped });
}
