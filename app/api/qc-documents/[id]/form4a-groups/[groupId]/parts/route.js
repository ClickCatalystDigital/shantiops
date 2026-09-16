import { NextResponse } from 'next/server';
import { execute, queryAll, queryOne } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';

// Bulk assign/unassign — the editor's own multi-select bar picks a group for however many parts
// are currently checked, in one request, rather than one call per part.
export async function POST(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'QC');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'QC', 'qc.document.write');
  if (actionDenied) return actionDenied;

  const group = await queryOne('SELECT id FROM qc_form4a_groups WHERE id = ? AND document_id = ?', [params.groupId, params.id]);
  if (!group) return NextResponse.json({ error: 'Group not found' }, { status: 404 });

  const b = await req.json();
  const ids = (Array.isArray(b.part_ids) ? b.part_ids : []).map(Number).filter(Boolean);
  if (!ids.length) return NextResponse.json({ error: 'No parts selected' }, { status: 400 });

  // Scoped to this document — a stray part id from elsewhere can't be reassigned through this route.
  const owned = await queryAll(
    `SELECT id FROM qc_document_parts WHERE document_id = ? AND id IN (${ids.map(() => '?').join(',')})`,
    [params.id, ...ids]);
  if (!owned.length) return NextResponse.json({ error: 'No matching parts' }, { status: 404 });
  const ownedIds = owned.map(r => r.id);

  await execute(
    `UPDATE qc_document_parts SET form4a_group_id = ? WHERE id IN (${ownedIds.map(() => '?').join(',')})`,
    [params.groupId, ...ownedIds]);
  return NextResponse.json({ ok: true, assigned: ownedIds.length });
}

// Move parts back to the flat/no-section list without deleting them.
export async function DELETE(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'QC');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'QC', 'qc.document.write');
  if (actionDenied) return actionDenied;

  const b = await req.json();
  const ids = (Array.isArray(b.part_ids) ? b.part_ids : []).map(Number).filter(Boolean);
  if (!ids.length) return NextResponse.json({ error: 'No parts selected' }, { status: 400 });

  await execute(
    `UPDATE qc_document_parts SET form4a_group_id = NULL
      WHERE document_id = ? AND form4a_group_id = ? AND id IN (${ids.map(() => '?').join(',')})`,
    [params.id, params.groupId, ...ids]);
  return NextResponse.json({ ok: true });
}
