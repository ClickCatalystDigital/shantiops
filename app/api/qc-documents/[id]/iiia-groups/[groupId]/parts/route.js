import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';

// Hand-move an already-synced part between Form IV A and this Form III A group (the always-works
// manual path — sync-bom auto-routes by assembly_id/group_label, this covers everything else). POST
// assigns; DELETE (../parts/[partId]) clears back to Form IV A. Scoped to this document+group so a
// stray part id from elsewhere can't be reassigned through this route.
export async function POST(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'QC');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'QC', 'qc.document.write');
  if (actionDenied) return actionDenied;

  const group = await queryOne('SELECT id FROM qc_iiia_groups WHERE id = ? AND document_id = ?', [params.groupId, params.id]);
  if (!group) return NextResponse.json({ error: 'Group not found' }, { status: 404 });

  const b = await req.json();
  const part = await queryOne('SELECT id FROM qc_document_parts WHERE id = ? AND document_id = ?', [b.part_id, params.id]);
  if (!part) return NextResponse.json({ error: 'Part not found' }, { status: 404 });

  await execute('UPDATE qc_document_parts SET iiia_group_id = ? WHERE id = ?', [params.groupId, part.id]);
  return NextResponse.json({ ok: true });
}

// Move a part back to Form IV A (iiia_group_id -> NULL) without deleting the row itself — same
// distinction as the group DELETE route.
export async function DELETE(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'QC');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'QC', 'qc.document.write');
  if (actionDenied) return actionDenied;

  const b = await req.json();
  const part = await queryOne(
    'SELECT id FROM qc_document_parts WHERE id = ? AND document_id = ? AND iiia_group_id = ?',
    [b.part_id, params.id, params.groupId]);
  if (!part) return NextResponse.json({ error: 'Part not found in this group' }, { status: 404 });

  await execute('UPDATE qc_document_parts SET iiia_group_id = NULL WHERE id = ?', [part.id]);
  return NextResponse.json({ ok: true });
}
