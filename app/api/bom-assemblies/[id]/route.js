import { NextResponse } from 'next/server';
import { execute, queryOne, queryAll, withTransaction } from '@/lib/db';
import { isBomReleased } from '@/lib/bom-line';
import { getFreshSessionUser } from '@/lib/auth';
import { requireEngineeringAction } from '@/lib/action-permissions';
import { audit } from '@/lib/usb';
import { findBlockedIds, findBlockingReferences } from '@/lib/bom-item-guard';
import { wouldCreateCycle } from '@/lib/bom-structure.mjs';
import { validateConfigInput, serializeConfig } from '@/lib/bom-config.mjs';

// BOM workspace Phase 2 — the load-bearing gap this whole feature was blocked on: there was no way
// to rename, reparent, reorder, or set a node_type after creation. Reuses the same
// engineering.assembly.add action key POST already gates (a PATCH on this resource is an edit to
// what that key already governs — see the plan's own reasoning for not fragmenting into
// move/link-specific keys).
//
// Two mutually exclusive request shapes: { move: 'up'|'down' } does an atomic sibling swap (Move
// Up/Down button); any of { name, qty, parent_id, node_type, sort_order } does a plain field
// update. A body is never expected to mix the two — the UI only ever fires one or the other.
export async function PATCH(req, { params }) {
  const user = await getFreshSessionUser();
  const actionDenied = await requireEngineeringAction(user, 'engineering.assembly.add');
  if (actionDenied) return actionDenied;

  const row = await queryOne('SELECT * FROM bom_assemblies WHERE id = ?', [params.id]);
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const b = await req.json();

  if (b.move === 'up' || b.move === 'down') {
    const siblings = await queryAll(
      row.parent_id == null
        ? 'SELECT id, sort_order FROM bom_assemblies WHERE project_id = ? AND parent_id IS NULL ORDER BY sort_order, id'
        : 'SELECT id, sort_order FROM bom_assemblies WHERE project_id = ? AND parent_id = ? ORDER BY sort_order, id',
      row.parent_id == null ? [row.project_id] : [row.project_id, row.parent_id]
    );
    const idx = siblings.findIndex(s => s.id === row.id);
    const swapIdx = b.move === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= siblings.length) {
      return NextResponse.json({ error: `Already at the ${b.move === 'up' ? 'top' : 'bottom'}` }, { status: 400 });
    }
    const other = siblings[swapIdx];
    await execute('UPDATE bom_assemblies SET sort_order = ? WHERE id = ?', [other.sort_order, row.id]);
    await execute('UPDATE bom_assemblies SET sort_order = ? WHERE id = ?', [row.sort_order, other.id]);
    await audit('bom_assembly_edit', { actor: user.username, detail: `project ${row.project_id}: moved ${row.name} ${b.move}` });
    return NextResponse.json({ ok: true });
  }

  const sets = [];
  const values = [];

  if (b.name !== undefined) {
    const name = String(b.name).trim();
    if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    sets.push('name = ?'); values.push(name);
  }
  if (b.qty !== undefined) {
    sets.push('qty = ?'); values.push(Number(b.qty) > 0 ? Number(b.qty) : 1);
  }
  if (b.node_type !== undefined) {
    sets.push('node_type = ?'); values.push(b.node_type ? String(b.node_type).trim() || null : null);
  }
  if (b.sort_order !== undefined) {
    sets.push('sort_order = ?'); values.push(Number(b.sort_order) || 0);
  }
  // Node Configuration (datasheet fields) — the whole list is saved at once (small, explicit Save in the UI).
  // Validated strictly here; an empty list clears it back to NULL.
  if (b.config !== undefined) {
    const err = validateConfigInput(b.config);
    if (err) return NextResponse.json({ error: err }, { status: 400 });
    sets.push('config_json = ?'); values.push(serializeConfig(b.config));
  }
  if (b.parent_id !== undefined) {
    const newParentId = b.parent_id === null ? null : Number(b.parent_id);
    if (newParentId != null) {
      const parent = await queryOne('SELECT id, project_id FROM bom_assemblies WHERE id = ?', [newParentId]);
      if (!parent || parent.project_id !== row.project_id) {
        return NextResponse.json({ error: 'Parent assembly not found on this project' }, { status: 400 });
      }
      const allInProject = await queryAll('SELECT id, parent_id, qty FROM bom_assemblies WHERE project_id = ?', [row.project_id]);
      const byId = new Map(allInProject.map(a => [a.id, a]));
      if (wouldCreateCycle(row.id, newParentId, byId)) {
        return NextResponse.json({ error: 'Cannot move an assembly under itself or one of its own sub-assemblies' }, { status: 400 });
      }
    }
    sets.push('parent_id = ?'); values.push(newParentId);
  }

  if (sets.length === 0) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });

  await execute(`UPDATE bom_assemblies SET ${sets.join(', ')} WHERE id = ?`, [...values, row.id]);
  await audit('bom_assembly_edit', {
    actor: user.username,
    detail: `project ${row.project_id}: ${row.name}${b.config !== undefined ? ` (configuration: ${Array.isArray(b.config) ? b.config.length : 0} row(s))` : ''}`,
  });
  return NextResponse.json({ ok: true });
}

// Deleting a node takes its whole subtree (see the rules inside). An item is never silently dropped out of the tree:
// it is deleted with the node only on ?delete_items=1, else moved to ?move_to (default the parent).
//
// ?cascade=1 is the one exception, and it's deliberately narrow: it recursively deletes the whole
// subtree AND its items (real deletes, not un-links) instead of the safe behavior above. Only the
// Structure Templates sandbox-edit flow needs this — a throwaway node under the sentinel "system"
// project, discarded or replaced by an Update Template every time. Honored ONLY when the target
// row's own project is that sentinel project (is_system=1), checked server-side regardless of what
// the caller passes — this makes the flag structurally impossible to point at a real project's real
// BOM data, even by a future caller's mistake.
export async function DELETE(req, { params }) {
  const user = await getFreshSessionUser();
  const actionDenied = await requireEngineeringAction(user, 'engineering.assembly.delete');
  if (actionDenied) return actionDenied;

  const row = await queryOne('SELECT * FROM bom_assemblies WHERE id = ?', [params.id]);
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const cascade = new URL(req.url).searchParams.get('cascade') === '1';
  if (cascade) {
    const project = await queryOne('SELECT is_system FROM projects WHERE id = ?', [row.project_id]);
    if (!project?.is_system) {
      return NextResponse.json({ error: 'Cascade delete is only available on the template sandbox' }, { status: 403 });
    }
    const all = await queryAll('SELECT id, parent_id FROM bom_assemblies WHERE project_id = ?', [row.project_id]);
    const childrenByParent = new Map();
    for (const a of all) {
      if (!childrenByParent.has(a.parent_id)) childrenByParent.set(a.parent_id, []);
      childrenByParent.get(a.parent_id).push(a);
    }
    const subtreeIds = [];
    (function collect(id) { subtreeIds.push(id); for (const c of childrenByParent.get(id) || []) collect(c.id); })(row.id);
    await execute(`DELETE FROM bom_items WHERE assembly_id IN (${subtreeIds.map(() => '?').join(',')})`, subtreeIds);
    await execute(`DELETE FROM bom_assemblies WHERE id IN (${subtreeIds.map(() => '?').join(',')})`, subtreeIds);
    return NextResponse.json({ ok: true, deletedNodes: subtreeIds.length });
  }

  // The node and everything under it (sub-nodes and their items) goes, after the person confirms in the UI.
  // Items are either deleted with it (?delete_items=1) or moved to another node outside the subtree (?move_to=,
  // default the parent). Refused as a whole, never half-done: released BOM, PR-raised lines, items with downstream
  // activity (bom-item-guard), QC records / Form III A groups on any node. ?dry=1 runs only these checks
  // (the UI calls it before showing its 5-second Undo, then sends the real delete).
  if (await isBomReleased(row.project_id)) {
    return NextResponse.json({ error: 'This BOM is released — un-release it before deleting a node' }, { status: 409 });
  }
  const url = new URL(req.url);
  const all = await queryAll('SELECT id, parent_id FROM bom_assemblies WHERE project_id = ?', [row.project_id]);
  const kids = new Map();
  for (const a of all) { if (!kids.has(a.parent_id)) kids.set(a.parent_id, []); kids.get(a.parent_id).push(a.id); }
  const ids = [];
  (function collect(id) { ids.push(id); for (const c of kids.get(id) || []) collect(c); })(row.id);
  const marks = ids.map(() => '?').join(',');
  const items = await queryAll(`SELECT id, material_description, pr_item_id FROM bom_items WHERE assembly_id IN (${marks})`, ids);
  const deleteItems = url.searchParams.get('delete_items') === '1';

  let moveTo = null;
  if (items.length && !deleteItems) {
    const asked = url.searchParams.get('move_to');
    moveTo = asked ? Number(asked) : row.parent_id;
    if (moveTo == null) {
      return NextResponse.json({ error: `This node holds ${items.length} item(s) — delete them too, or choose a node to move them to` }, { status: 409 });
    }
    const dest = await queryOne('SELECT id, project_id FROM bom_assemblies WHERE id = ?', [moveTo]);
    if (!dest || Number(dest.project_id) !== Number(row.project_id) || ids.includes(Number(dest.id))) {
      return NextResponse.json({ error: 'Choose a node outside the one being deleted to move the items to' }, { status: 400 });
    }
  }
  if (deleteItems && items.length) {
    const pr = items.filter(i => i.pr_item_id != null);
    if (pr.length) {
      return NextResponse.json({ error: `${pr.length} line(s) were raised through Purchase Requests (e.g. "${pr[0].material_description}") — cancel those first, or move the items instead. Nothing was deleted.` }, { status: 409 });
    }
    const blocked = await findBlockedIds(items.map(i => i.id));
    if (blocked.size) {
      const first = items.find(i => i.id === [...blocked][0]);
      const { reasons } = await findBlockingReferences(first.id);
      return NextResponse.json({ error: `${blocked.size} item(s) have downstream activity (e.g. "${first.material_description}" ${reasons[0]?.label}) — move the items instead. Nothing was deleted.` }, { status: 409 });
    }
  }
  const qc = await queryOne(`SELECT (SELECT COUNT(*) FROM qc_records WHERE assembly_id IN (${marks})) + (SELECT COUNT(*) FROM qc_iiia_groups WHERE assembly_id IN (${marks})) AS n`, [...ids, ...ids]);
  if (qc.n > 0) {
    return NextResponse.json({ error: 'QC has records or Form III A groups tied to this node or one under it — that history is kept. Nothing was deleted.' }, { status: 409 });
  }
  if (url.searchParams.get('dry') === '1') return NextResponse.json({ ok: true, nodes: ids.length, items: items.length });

  try {
    await withTransaction(async tx => {
      if (items.length) {
        await tx.execute(deleteItems
          ? { sql: `DELETE FROM bom_items WHERE assembly_id IN (${marks})`, args: ids }
          : { sql: `UPDATE bom_items SET assembly_id = ? WHERE assembly_id IN (${marks})`, args: [moveTo, ...ids] });
      }
      await tx.execute({ sql: `DELETE FROM bom_assembly_drawings WHERE assembly_id IN (${marks})`, args: ids });
      await tx.execute({ sql: `DELETE FROM bom_assembly_calc_sheets WHERE assembly_id IN (${marks})`, args: ids });
      // one statement, so the parent_id self-FK is checked once at the end
      await tx.execute({ sql: `DELETE FROM bom_assemblies WHERE id IN (${marks})`, args: ids });
    });
  } catch (err) {
    if (/FOREIGN KEY|constraint/i.test(String(err?.message))) {
      return NextResponse.json({ error: 'Something under this node is still referenced (new activity?) — nothing was changed' }, { status: 409 });
    }
    throw err;
  }
  const itemCount = items.length;
  await audit('bom_assembly_delete', { actor: user.username, detail: `project ${row.project_id}: ${row.name} + ${ids.length - 1} sub-node(s)${itemCount ? ` — ${itemCount} item(s) ${deleteItems ? 'deleted' : `moved to node ${moveTo}`}` : ''}` });
  return NextResponse.json({ ok: true, nodes: ids.length, items: itemCount });
}
