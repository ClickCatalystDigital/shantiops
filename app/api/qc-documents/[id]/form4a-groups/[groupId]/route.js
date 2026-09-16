import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';

export async function PATCH(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'QC');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'QC', 'qc.document.write');
  if (actionDenied) return actionDenied;

  const group = await queryOne('SELECT id FROM qc_form4a_groups WHERE id = ? AND document_id = ?', [params.groupId, params.id]);
  if (!group) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const b = await req.json();
  if (!String(b.name || '').trim()) {
    return NextResponse.json({ error: 'Group name is required' }, { status: 400 });
  }
  await execute('UPDATE qc_form4a_groups SET name = ? WHERE id = ?', [b.name.trim(), params.groupId]);
  return NextResponse.json({ ok: true });
}

// Deleting a group reverts its parts to a flat/no-section row (form4a_group_id -> NULL) rather than
// deleting them — same convention as qc_iiia_groups' own DELETE route.
export async function DELETE(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'QC');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'QC', 'qc.document.delete');
  if (actionDenied) return actionDenied;

  const group = await queryOne('SELECT id FROM qc_form4a_groups WHERE id = ? AND document_id = ?', [params.groupId, params.id]);
  if (!group) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  await execute('UPDATE qc_document_parts SET form4a_group_id = NULL WHERE form4a_group_id = ?', [params.groupId]);
  await execute('DELETE FROM qc_form4a_groups WHERE id = ?', [params.groupId]);
  return NextResponse.json({ ok: true });
}
