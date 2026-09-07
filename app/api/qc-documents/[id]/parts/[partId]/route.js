import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { audit } from '@/lib/usb';

// Edit a part's own fields (size/qty/name/no.) — the gap between AddPartDialog (create-only) and
// this route (previously DELETE-only): no path existed to fix a typo'd size or qty after creation.
// Same shape as AddPartDialog's own fields; bom_item_id/certificate linking stay on their own
// dedicated routes (link-bom-item, link-parts) since those carry extra side effects (suggestion
// matching, sibling fan-out) this route has no business re-implementing.
const EDITABLE = ['part_no', 'part_name', 'size_t', 'size_w', 'size_l', 'qty'];

export async function PATCH(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'QC');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'QC', 'qc.document.write');
  if (actionDenied) return actionDenied;

  const part = await queryOne('SELECT id FROM qc_document_parts WHERE id = ? AND document_id = ?', [params.partId, params.id]);
  if (!part) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const b = await req.json();
  const fields = EDITABLE.filter(f => f in b);
  if (!fields.length) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
  if ('part_name' in b && !String(b.part_name || '').trim()) {
    return NextResponse.json({ error: 'Part name is required' }, { status: 400 });
  }

  await execute(
    `UPDATE qc_document_parts SET ${fields.map(f => `${f} = ?`).join(', ')} WHERE id = ?`,
    [...fields.map(f => b[f]), params.partId]);

  await audit('qc_document_part_edit', {
    actor: user.username,
    detail: JSON.stringify({ qc_document_id: Number(params.id), part_id: Number(params.partId), fields }),
  });
  return NextResponse.json({ ok: true });
}

// V2-CHANGES.md Group 2 — remove a part that's an exception (not applicable to this boiler, entered
// in error, etc.). No linkage guard needed here — unlike deleting a certificate (which could break
// other documents), removing a part only affects this one document's own list, and removing an
// unlinked part can only ever shrink what Preview PDF's hard gate requires, never break it.
export async function DELETE(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'QC');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'QC', 'qc.document.delete');
  if (actionDenied) return actionDenied;

  // Scoped to this document — a stray/forged part id from another document must not be deletable
  // through this route, same trust-boundary reasoning as link-parts' own ownership check.
  const part = await queryOne(
    'SELECT id, part_name FROM qc_document_parts WHERE id = ? AND document_id = ?', [params.partId, params.id]);
  if (!part) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  await execute('DELETE FROM qc_document_parts WHERE id = ?', [params.partId]);

  await audit('qc_document_part_remove', {
    actor: user.username,
    detail: JSON.stringify({ qc_document_id: Number(params.id), part_id: Number(params.partId), part_name: part.part_name }),
  });
  return NextResponse.json({ ok: true });
}
