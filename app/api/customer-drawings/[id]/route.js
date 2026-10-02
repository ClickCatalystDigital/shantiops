import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, isCustomer, canAccessProject, hasActiveDesignResponsibility } from '@/lib/auth';
import { requireCalcAccess } from '@/lib/calc';
import { deleteObject } from '@/lib/r2';
import { notifyProjectCustomers } from '@/lib/notify';
import { audit } from '@/lib/usb';

// PATCH {status: reviewed|needs_changes, note} — Design/Engineering review of an upload.
export async function PATCH(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireCalcAccess(user);
  if (denied) return denied;
  const row = await queryOne('SELECT id, project_id, label FROM customer_drawing_uploads WHERE id = ?', [params.id]);
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const b = await req.json();
  if (!['reviewed', 'needs_changes'].includes(b.status)) return NextResponse.json({ error: 'Pick Reviewed or Needs changes' }, { status: 400 });
  const note = String(b.note || '').trim().slice(0, 500) || null;
  if (b.status === 'needs_changes' && !note) return NextResponse.json({ error: 'Tell the customer what needs to change' }, { status: 400 });
  await execute(`UPDATE customer_drawing_uploads SET status = ?, review_note = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [b.status, note, user.display_name || user.username, row.id]);
  await audit('customer_drawing_reviewed', { actor: user.username, detail: `upload ${row.id} -> ${b.status}` });
  try {
    await notifyProjectCustomers(row.project_id, {
      kind: 'customer_drawing_review', dedupe_key: `customer_drawing_review:${row.id}:${b.status}:${Date.now()}`,
      title: b.status === 'reviewed' ? 'Design reviewed your drawing' : 'Design needs a change to your drawing',
      body: row.label,
    });
  } catch { /* best effort */ }
  return NextResponse.json({ ok: true });
}

// DELETE — the uploader while it is still open for changes; the Design Head any time.
export async function DELETE(_req, { params }) {
  const user = await getFreshSessionUser();
  const row = await queryOne('SELECT id, project_id, file_key, status, uploaded_by FROM customer_drawing_uploads WHERE id = ?', [params.id]);
  if (!row) return NextResponse.json({ ok: true });
  if (isCustomer(user)) {
    if (!canAccessProject(user, row.project_id) || row.uploaded_by !== user.username) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    if (row.status === 'reviewed') return NextResponse.json({ error: 'Design has already reviewed this drawing' }, { status: 409 });
  } else {
    const denied = requireCalcAccess(user);
    if (denied) return denied;
    if (!(await hasActiveDesignResponsibility(user, 'head'))) return NextResponse.json({ error: 'Only the Design Head can delete a customer drawing' }, { status: 403 });
  }
  await execute('DELETE FROM customer_drawing_uploads WHERE id = ?', [row.id]);
  try { await deleteObject(row.file_key); } catch { /* row is gone; an orphaned object is harmless */ }
  await audit('customer_drawing_deleted', { actor: user.username, detail: `upload ${row.id}` });
  return NextResponse.json({ ok: true });
}
