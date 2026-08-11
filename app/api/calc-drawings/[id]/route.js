import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { requireCalcAccess, updateDrawing, getDrawingFiles, deleteDrawing } from '@/lib/calc';
import { deleteObject } from '@/lib/r2';
import { audit } from '@/lib/usb';

const PATCHABLE = { status: 'status', assignedTo: 'assigned_to', dueDate: 'due_date', notes: 'notes', name: 'name', description: 'description', drawingType: 'drawing_type' };

export async function PATCH(req, { params }) {
  const user = getSessionUser();
  const denied = requireCalcAccess(user);
  if (denied) return denied;

  const b = await req.json();
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
  const user = getSessionUser();
  const denied = requireCalcAccess(user);
  if (denied) return denied;

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
