import { NextResponse } from 'next/server';
import { execute, queryOne, queryAll } from '@/lib/db';
import { getFreshSessionUser } from '@/lib/auth';
import { requireEngineeringAction } from '@/lib/action-permissions';
import { audit } from '@/lib/usb';
import { wouldCreateCycle } from '@/lib/bom-structure.mjs';

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
  await audit('bom_assembly_edit', { actor: user.username, detail: `project ${row.project_id}: ${row.name}` });
  return NextResponse.json({ ok: true });
}

// Deleting an assembly un-links (not deletes) any bom_items under it — a BOM row must stay a
// packable leaf regardless of assembly membership (§5a invariant, packing_items.bom_item_id joins
// bom_items.id directly). Child assemblies are blocked, same "resolve the tree first" precedent as
// bom-items DELETE blocking on packed/reserved rows, rather than silently cascading a whole subtree.
export async function DELETE(req, { params }) {
  const user = await getFreshSessionUser();
  const actionDenied = await requireEngineeringAction(user, 'engineering.assembly.delete');
  if (actionDenied) return actionDenied;

  const row = await queryOne('SELECT * FROM bom_assemblies WHERE id = ?', [params.id]);
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const child = await queryOne('SELECT COUNT(*) AS n FROM bom_assemblies WHERE parent_id = ?', [params.id]);
  if (child.n > 0) {
    return NextResponse.json({ error: 'This assembly has sub-assemblies — delete those first' }, { status: 409 });
  }

  await execute('UPDATE bom_items SET assembly_id = NULL WHERE assembly_id = ?', [params.id]);
  await execute('DELETE FROM bom_assemblies WHERE id = ?', [params.id]);
  await audit('bom_assembly_delete', { actor: user.username, detail: `project ${row.project_id}: ${row.name}` });
  return NextResponse.json({ ok: true });
}
