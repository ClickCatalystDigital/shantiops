import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { audit } from '@/lib/usb';

// The Form III A header fields (the real sample's 10-field block) — editable independently of the
// parts sub-table. name/assembly_id/group_label stay set at creation time; this route is for the
// certificate content, not re-scoping which BOM lines match.
const FIELDS = ['design_pressure', 'design_temp', 'hydro_test_pressure', 'hydro_test_date',
  'process_of_manufacture', 'mode_of_flange_attachment', 'flange_particulars', 'size_of_branch',
  'heat_treatment', 'identification_marks', 'drawing_no', 'calc_drawing_id'];

export async function PATCH(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'QC');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'QC', 'qc.document.write');
  if (actionDenied) return actionDenied;

  const group = await queryOne('SELECT id FROM qc_iiia_groups WHERE id = ? AND document_id = ?', [params.groupId, params.id]);
  if (!group) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const b = await req.json();
  const sets = FIELDS.filter(f => f in b);
  if (!sets.length) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });

  await execute(
    `UPDATE qc_iiia_groups SET ${sets.map(f => `${f} = ?`).join(', ')} WHERE id = ?`,
    [...sets.map(f => (typeof b[f] === 'string' ? b[f].trim() || null : b[f] ?? null)), params.groupId]);

  return NextResponse.json({ ok: true });
}

// Deleting a group reverts its parts to Form IV A (iiia_group_id -> NULL) rather than deleting them —
// a III A group is a certificate scoping, not the parts' only home.
export async function DELETE(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'QC');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'QC', 'qc.document.delete');
  if (actionDenied) return actionDenied;

  const group = await queryOne('SELECT id, name FROM qc_iiia_groups WHERE id = ? AND document_id = ?', [params.groupId, params.id]);
  if (!group) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  await execute('UPDATE qc_document_parts SET iiia_group_id = NULL WHERE iiia_group_id = ?', [params.groupId]);
  await execute('DELETE FROM qc_iiia_groups WHERE id = ?', [params.groupId]);

  await audit('qc_iiia_group_remove', {
    actor: user.username,
    detail: JSON.stringify({ qc_document_id: Number(params.id), group_id: Number(params.groupId), name: group.name }),
  });
  return NextResponse.json({ ok: true });
}
