// app/api/engineering-change-notes/[id]/route.js — approve/reject. On approval, applies the
// old->new value straight onto the bom_item (when one is linked) and stamps effective_revision
// with the project's *current* bom_release_revision (lib/db.js, shipped 2026-08-19) — reused, not
// a new revision counter. Guarded against re-deciding an already-decided note, same idiom as
// sales-returns' double-credit guard.
import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { audit } from '@/lib/usb';
import { BOM_FIELD_OWNERS } from '@/lib/bom-fields.mjs';
import { canDecideChangeNote } from '@/lib/bom-structure.mjs';

export async function PATCH(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Engineering');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Engineering', 'engineering.ecn.approve');
  if (actionDenied) return actionDenied;

  const row = await queryOne('SELECT * FROM bom_change_notes WHERE id = ?', [params.id]);
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!canDecideChangeNote(row.status)) {
    return NextResponse.json({ error: `Already ${row.status}` }, { status: 409 });
  }

  const b = await req.json();
  const decision = b.status === 'approved' ? 'approved' : b.status === 'rejected' ? 'rejected' : null;
  if (!decision) return NextResponse.json({ error: "status must be 'approved' or 'rejected'" }, { status: 400 });

  let effectiveRevision = null;
  if (decision === 'approved') {
    const project = await queryOne('SELECT bom_release_revision FROM projects WHERE id = ?', [row.project_id]);
    effectiveRevision = project?.bom_release_revision || 0;
    // Re-checked at the trust boundary, not just on the way in — field_changed is stored data by
    // the time it reaches an UPDATE's column list.
    if (row.bom_item_id && row.new_value != null && BOM_FIELD_OWNERS.Engineering.includes(row.field_changed)) {
      await execute(`UPDATE bom_items SET ${row.field_changed} = ? WHERE id = ?`, [row.new_value, row.bom_item_id]);
    }
  }

  await execute(
    `UPDATE bom_change_notes SET status = ?, approved_by = ?, effective_revision = ?, decided_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [decision, user.username, effectiveRevision, params.id]
  );
  await audit('bom_change_note_decided', { actor: user.username, detail: `ECN ${params.id}: ${decision}` });
  return NextResponse.json({ ok: true });
}
