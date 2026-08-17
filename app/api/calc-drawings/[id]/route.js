import { NextResponse } from 'next/server';
import { getFreshSessionUser, hasActiveDesignResponsibility } from '@/lib/auth';
import { queryOne } from '@/lib/db';
import { requireCalcAccess, updateDrawing, getDrawingFiles, deleteDrawing } from '@/lib/calc';
import { deleteObject } from '@/lib/r2';
import { audit } from '@/lib/usb';

const PATCHABLE = { status: 'status', assignedTo: 'assigned_to', dueDate: 'due_date', notes: 'notes', name: 'name', description: 'description', drawingType: 'drawing_type', customerVisible: 'customer_visible' };

export async function PATCH(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireCalcAccess(user);
  if (denied) return denied;

  const b = await req.json();
  const head = await hasActiveDesignResponsibility(user, 'head');
  const designer = await hasActiveDesignResponsibility(user, 'designer');
  if (!head && !designer) return NextResponse.json({ error: 'Design access required' }, { status: 403 });
  if (!head && (b.assignedTo !== undefined || b.dueDate !== undefined || b.customerVisible !== undefined)) {
    return NextResponse.json({ error: 'Only the Design Head can assign work, set due dates, or share a drawing with the customer' }, { status: 403 });
  }
  if (!head && b.status !== undefined && !['not_started', 'in_progress', 'under_review'].includes(b.status)) return NextResponse.json({ error: 'Designers can submit work for review but cannot approve it' }, { status: 403 });
  if (b.assignedTo !== undefined && b.assignedTo) {
    const employee = await queryOne("SELECT id FROM employees WHERE name = ? AND department = 'Design' AND active = 1", [String(b.assignedTo)]);
    if (!employee) return NextResponse.json({ error: 'Assigned person must be an active Design employee' }, { status: 400 });
  }
  const fields = {};
  for (const [key, column] of Object.entries(PATCHABLE)) {
    if (b[key] !== undefined && key !== 'customerVisible') fields[column] = b[key];
  }
  if (b.customerVisible !== undefined) {
    const current = await queryOne('SELECT customer_visible FROM calc_drawings WHERE id = ?', [params.id]);
    const next = b.customerVisible ? 1 : 0;
    fields.customer_visible = next;
    // Only a genuine 0->1 flip starts the 5-minute notification clock; a genuine 1->0 flip clears
    // it. Re-PATCHing the same value again (no real transition) leaves the clock untouched, so a
    // flip-and-flip-back inside the window (an accidental toggle) never reaches the sweep at all.
    if (next === 1 && !current?.customer_visible) {
      fields.customer_visible_since = new Date().toISOString().slice(0, 19).replace('T', ' ');
      fields.customer_notified_at = null;
    } else if (next === 0 && current?.customer_visible) {
      fields.customer_visible_since = null;
      fields.customer_notified_at = null;
    }
  }
  if (!Object.keys(fields).length) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });

  await updateDrawing(params.id, fields);
  await audit('calc_drawing_edit', { actor: user.username, detail: `drawing ${params.id}` });
  return NextResponse.json({ ok: true });
}

// Cascade: delete every file row + its R2 object (best-effort — R2 env isn't set in dev, same
// try/catch precedent as test-certificates' PDF routes) before dropping the drawing itself.
export async function DELETE(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireCalcAccess(user);
  if (denied) return denied;
  if (!(await hasActiveDesignResponsibility(user, 'head'))) return NextResponse.json({ error: 'Only the Design Head can delete drawings' }, { status: 403 });

  const files = await getDrawingFiles(params.id);
  for (const f of files) {
    try {
      await deleteObject(f.file_key);
    } catch (e) {
      // R2 not configured or object already gone — the DB row below is still the source of truth.
    }
  }
  await deleteDrawing(params.id);
  await audit('calc_drawing_deleted', { actor: user.username, detail: `drawing ${params.id}` });
  return NextResponse.json({ ok: true });
}
