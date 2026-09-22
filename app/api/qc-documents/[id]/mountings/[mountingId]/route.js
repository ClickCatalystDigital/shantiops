import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { audit } from '@/lib/usb';

// Edit one bought-out item row — the per-row twin of parts/[partId]/route.js. Replaces the old
// "buffer edits locally, delete the whole list and reinsert on Save" flow: that regenerated every
// row's id on every save (breaking the certificate badge lookup, which is keyed on id), and meant a
// deleted-but-never-Saved row silently came back on the next page load. Every field here is
// optional — qc_mountings has no required columns — so a partial edit is always valid.
const EDITABLE = ['description', 'size', 'moc', 'serial_numbers', 'make', 'qty', 'bom_item_id'];

export async function PATCH(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'QC');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'QC', 'qc.document.write');
  if (actionDenied) return actionDenied;

  const row = await queryOne(
    `SELECT qm.id, qd.project_id, p.master_project_id FROM qc_mountings qm
       JOIN qc_documents qd ON qd.id = qm.document_id
       JOIN projects p ON p.id = qd.project_id
       WHERE qm.id = ? AND qm.document_id = ?`, [params.mountingId, params.id]);
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const b = await req.json();
  const fields = EDITABLE.filter(f => f in b);
  if (!fields.length) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });

  const vals = { ...b };
  if (fields.includes('bom_item_id') && vals.bom_item_id != null) {
    // A split child's own BOM items live only on the master (§5k/§5bj) — same ownership check
    // link-bom-item already uses, so a forged/cross-project id can't be linked here either.
    const bomProjectId = row.master_project_id || row.project_id;
    const bomItem = await queryOne('SELECT id FROM bom_items WHERE id = ? AND project_id = ?', [vals.bom_item_id, bomProjectId]);
    if (!bomItem) return NextResponse.json({ error: 'BOM item not found on this project' }, { status: 404 });
    // (document_id, bom_item_id) is uniquely indexed — a second row picking the same BOM item would
    // violate it. Drop the link instead of failing the whole save, same precedent the old bulk-replace
    // route used — this now fires per edit rather than behind one deliberate Save click.
    const dupe = await queryOne(
      'SELECT id FROM qc_mountings WHERE document_id = ? AND bom_item_id = ? AND id != ?',
      [params.id, vals.bom_item_id, params.mountingId]);
    if (dupe) vals.bom_item_id = null;
  }

  await execute(
    `UPDATE qc_mountings SET ${fields.map(f => `${f} = ?`).join(', ')} WHERE id = ?`,
    [...fields.map(f => (typeof vals[f] === 'string' ? (vals[f].trim() || null) : (vals[f] ?? null))), params.mountingId]);

  await audit('qc_mounting_edit', {
    actor: user.username,
    detail: JSON.stringify({ qc_document_id: Number(params.id), mounting_id: Number(params.mountingId), fields }),
  });
  return NextResponse.json({ ok: true, bom_item_id: fields.includes('bom_item_id') ? vals.bom_item_id : undefined });
}

// Removing an item that's an exception (wrong pick, not applicable to this boiler) only affects this
// one document's own list — same "no linkage guard needed" reasoning as parts/[partId]'s own DELETE.
export async function DELETE(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'QC');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'QC', 'qc.document.delete');
  if (actionDenied) return actionDenied;

  const row = await queryOne(
    'SELECT id, description FROM qc_mountings WHERE id = ? AND document_id = ?', [params.mountingId, params.id]);
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  await execute('DELETE FROM qc_mountings WHERE id = ?', [params.mountingId]);

  await audit('qc_mounting_remove', {
    actor: user.username,
    detail: JSON.stringify({ qc_document_id: Number(params.id), mounting_id: Number(params.mountingId), description: row.description }),
  });
  return NextResponse.json({ ok: true });
}
