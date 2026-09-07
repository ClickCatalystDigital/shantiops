import { NextResponse } from 'next/server';
import { getFreshSessionUser, hasActiveDesignResponsibility } from '@/lib/auth';
import { requireCalcAccess, requireCalcReadAccess, getCalcDrawings, addDrawing, findDesignEmployeeByName, findMyDesignEmployee } from '@/lib/calc';
import { audit } from '@/lib/usb';

// CALC-CHANGES2.md §B — list/create drawings for a project. Mirrors calc-notes' route shape.
export async function GET(req) {
  const user = await getFreshSessionUser();
  const denied = requireCalcReadAccess(user);
  if (denied) return denied;

  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get('project_id');
  if (!projectId) return NextResponse.json({ error: 'project_id is required' }, { status: 400 });
  // BOM workspace Phase 2 — optional approval-state filter for the node-drawing picker. No param =
  // every existing caller's behavior, byte-for-byte unchanged.
  const statusParam = searchParams.get('status');
  const statuses = statusParam ? statusParam.split(',').map(s => s.trim()).filter(Boolean) : null;

  const drawings = await getCalcDrawings(projectId, statuses);
  return NextResponse.json({ drawings });
}

// A new drawing is only useful once someone is assigned to it (whoever it's for finds out via
// notification) — the Head picks who; anyone else creating one is obviously creating it for
// themselves, so it's assigned to them automatically, no picker needed.
export async function POST(req) {
  const user = await getFreshSessionUser();
  const denied = requireCalcAccess(user);
  if (denied) return denied;

  const b = await req.json();
  const name = String(b.name || '').trim();
  if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 });
  if (!b.projectId) return NextResponse.json({ error: 'projectId is required' }, { status: 400 });

  const head = await hasActiveDesignResponsibility(user, 'head');
  let assignedTo;
  if (head) {
    assignedTo = String(b.assignedTo || '').trim();
    if (!assignedTo) return NextResponse.json({ error: 'Assign a Design teammate' }, { status: 400 });
    const employee = await findDesignEmployeeByName(assignedTo);
    if (!employee) return NextResponse.json({ error: 'Assigned person must be an active Design employee' }, { status: 400 });
  } else {
    const me = await findMyDesignEmployee(user.id);
    if (!me) return NextResponse.json({ error: 'Only a Design team member or the Design Head can create drawings' }, { status: 403 });
    assignedTo = me.name;
  }

  const id = await addDrawing({ projectId: b.projectId, name, description: b.description, drawingType: b.drawingType, assignedTo });
  await audit('calc_drawing_created', { actor: user.username, detail: name });
  return NextResponse.json({ id });
}
