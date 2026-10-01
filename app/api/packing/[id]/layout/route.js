// Editing actions for a combined packing list: move lines between groups, rename/retype/merge groups, show
// several sizes under one item, make an assembly line from selected lines (and expand it back), reorder.
// Drafts only. Rules live in lib/packing-layout.mjs; this applies the diff in one transaction.
import { NextResponse } from 'next/server';
import { queryOne, queryAll, withTransaction } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { audit } from '@/lib/usb';
import { unitLabelOf } from '@/lib/packing-forms.mjs';
import * as L from '@/lib/packing-layout.mjs';
import { recordChoice } from '@/lib/packing-memory';
import { loadModel, applyDiff, normalizeList } from '@/lib/packing-layout';

export async function POST(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Dispatch');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Dispatch', 'dispatch.packing.edit');
  if (actionDenied) return actionDenied;
  const b = await req.json();
  const listId = Number(params.id);

  const list = await queryOne(
    `SELECT pl.id, pl.status, pl.layout, pl.master_section, COALESCE(pl.company, p.company) AS company,
            p.project_no, p.unit_no, p.master_project_id
       FROM packing_lists pl LEFT JOIN projects p ON p.id = pl.project_id WHERE pl.id = ?`, [listId]);
  if (!list) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (list.layout !== 'combined') return NextResponse.json({ error: 'This list uses the older layout and cannot be regrouped.' }, { status: 400 });
  if (list.status !== 'draft') return NextResponse.json({ error: 'Only a draft list can be rearranged — set it back to draft first.' }, { status: 409 });

  const { rows, linksOf, bomOf } = await loadModel(listId);
  const unitLabel = unitLabelOf(list);
  const ids = Array.isArray(b.ids) ? b.ids.map(Number).filter(Boolean) : [];
  const ownIds = new Set(rows.map(r => r.id));
  if (ids.some(i => !ownIds.has(i))) return NextResponse.json({ error: 'A selected line is not on this list' }, { status: 400 });

  let diff;
  switch (b.action) {
    case 'move': diff = L.moveItems(rows, { ids, group_label: b.group_label, new_group: b.new_group, unitLabel }); break;
    case 'edit_group': diff = L.editGroup(rows, { group_label: b.group_label, new_label: b.new_label, pack_type: b.pack_type, unitLabel }); break;
    case 'make_sizes': diff = L.makeSizes(rows, { ids, parent_id: b.parent_id ? Number(b.parent_id) : undefined }); break;
    case 'promote_size': diff = L.promoteSize(rows, { id: Number(b.id) }); break;
    case 'make_assembly': diff = L.makeAssembly(rows, { ids, name: b.name, pieces: b.pieces, size_spec: b.size_spec, makeName: String(list.company || '').split(/\s+/)[0].toUpperCase() }, linksOf); break;
    case 'expand': diff = L.expandAssembly(rows, { id: Number(b.id) }, linksOf, bomOf); break;
    case 'reorder': diff = L.reorderItem(rows, { id: Number(b.id), dir: b.dir === 'up' ? 'up' : 'down' }); break;
    default: return NextResponse.json({ error: `Unknown action: ${b.action}` }, { status: 400 });
  }
  if (diff.error) return NextResponse.json({ error: diff.error }, { status: 400 });

  await withTransaction(async tx => {
    await applyDiff(tx, listId, diff);
    await normalizeList(tx, listId, list.master_section);
  });
  // Learn only from explicit human choices (best effort — never blocks the edit).
  try {
    const bomOfRows = ids => rows.filter(r => ids.includes(r.id)).flatMap(r => { const l = linksOf(r.id); return l.length ? l.map(x => x.bom_item_id) : [r.bom_item_id]; }).filter(Boolean);
    if (b.action === 'move') { const t = rows.find(r => r.group_label === b.group_label)?.pack_type || b.new_group; if (t) await recordChoice(bomOfRows(ids), 'pack_type', String(t).toLowerCase(), user.username); }
    if (b.action === 'make_assembly') await recordChoice(diff.links.map(l => l.bom_item_id), 'ships_as', 'assembly', user.username);
    if (b.action === 'expand') await recordChoice(linksOf(Number(b.id)).map(l => l.bom_item_id), 'ships_as', 'item', user.username);
  } catch { /* learning is optional */ }
  await audit('packing_layout', { actor: user.username, detail: `list ${listId} · ${b.action}${ids.length ? ` · ${ids.length} line(s)` : ''}` });
  const items = await queryAll('SELECT * FROM packing_items WHERE packing_list_id = ? ORDER BY sort_order, id', [listId]);
  return NextResponse.json({ ok: true, items, label: diff.label || null });
}
