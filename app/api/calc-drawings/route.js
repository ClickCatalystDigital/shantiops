import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { requireCalcAccess, getCalcDrawings, addDrawing } from '@/lib/calc';
import { audit } from '@/lib/usb';

// CALC-CHANGES2.md §B — list/create drawings for a project. Mirrors calc-notes' route shape.
export async function GET(req) {
  const user = getSessionUser();
  const denied = requireCalcAccess(user);
  if (denied) return denied;

  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get('project_id');
  if (!projectId) return NextResponse.json({ error: 'project_id is required' }, { status: 400 });

  const drawings = await getCalcDrawings(projectId);
  return NextResponse.json({ drawings });
}

export async function POST(req) {
  const user = getSessionUser();
  const denied = requireCalcAccess(user);
  if (denied) return denied;

  const b = await req.json();
  const name = String(b.name || '').trim();
  if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 });
  if (!b.projectId) return NextResponse.json({ error: 'projectId is required' }, { status: 400 });

  const id = await addDrawing({ projectId: b.projectId, name, description: b.description, drawingType: b.drawingType });
  await audit('calc_drawing_created', { actor: user.username, detail: name });
  return NextResponse.json({ id });
}
