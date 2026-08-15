import { NextResponse } from 'next/server';
import { getFreshSessionUser, hasActiveDesignResponsibility } from '@/lib/auth';
import { queryOne } from '@/lib/db';
import { requireCalcAccess, updateDrawing, getDrawingFiles, deleteDrawing } from '@/lib/calc';
import { deleteObject } from '@/lib/r2';
import { audit } from '@/lib/usb';

const PATCHABLE = { status: 'status', assignedTo: 'assigned_to', dueDate: 'due_date', notes: 'notes', name: 'name', description: 'description', drawingType: 'drawing_type' };

export async function PATCH(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireCalcAccess(user);
  if (denied) return denied;

  const b = await req.json();
  const head = await hasActiveDesignResponsibility(user, 'head');
  const designer = await hasActiveDesignResponsibility(user, 'designer');
  if (!head && !designer) return NextResponse.json({ error: 'Design access required' }, { status: 403 });
  if (!head && (b.assignedTo !== undefined || b.dueDate !== undefined)) return NextResponse.json({ error: 'Only the Design Head can assign work or set due dates' }, { status: 403 });
  if (!head && b.status !== undefined && !['not_started', 'in_progress', 'under_review'].includes(b.status)) return NextResponse.json({ error: 'Designers can submit work for review but cannot approve it' }, { status: 403 });
  if (b.assignedTo !== undefined && b.assignedTo) {
    const employee = await queryOne("SELECT id FROM employees WHERE name = ? AND department = 'Design' AND active = 1", [String(b.assignedTo)]);
    if (!employee) return NextResponse.json({ error: 'Assigned person must be an active Design employee' }, { status: 400 });
  }
  const fields = {};
  for (const [key, column] of Object.entries(PATCHABLE)) {
    if (b[key] !== undefined) fields[column] = b[key];
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
