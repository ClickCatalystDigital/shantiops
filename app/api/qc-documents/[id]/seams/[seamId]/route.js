import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';

// The one editable field per row — sequence/location are set at creation and not re-scoped here,
// same "content vs. identity" split app/api/qc-documents/[id]/iiia-groups/[groupId]/route.js already
// draws (name/assembly_id/group_label stay fixed there too, only certificate content is PATCHable).
export async function PATCH(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'QC');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'QC', 'qc.document.write');
  if (actionDenied) return actionDenied;

  const seam = await queryOne(
    'SELECT id FROM qc_document_longitudinal_seams WHERE id = ? AND document_id = ?', [params.seamId, params.id]);
  if (!seam) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const b = await req.json();
  if (!('seam_count' in b)) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });

  await execute('UPDATE qc_document_longitudinal_seams SET seam_count = ? WHERE id = ?',
    [String(b.seam_count || '').trim() || null, params.seamId]);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'QC');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'QC', 'qc.document.delete');
  if (actionDenied) return actionDenied;

  const seam = await queryOne(
    'SELECT id FROM qc_document_longitudinal_seams WHERE id = ? AND document_id = ?', [params.seamId, params.id]);
  if (!seam) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  await execute('DELETE FROM qc_document_longitudinal_seams WHERE id = ?', [params.seamId]);
  return NextResponse.json({ ok: true });
}
