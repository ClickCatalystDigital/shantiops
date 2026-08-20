import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { audit } from '@/lib/usb';

// Deleting an assembly un-links (not deletes) any bom_items under it — a BOM row must stay a
// packable leaf regardless of assembly membership (§5a invariant, packing_items.bom_item_id joins
// bom_items.id directly). Child assemblies are blocked, same "resolve the tree first" precedent as
// bom-items DELETE blocking on packed/reserved rows, rather than silently cascading a whole subtree.
export async function DELETE(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Engineering');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Engineering', 'engineering.assembly.delete');
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
