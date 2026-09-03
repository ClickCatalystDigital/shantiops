import { NextResponse } from 'next/server';
import { execute, queryOne, queryAll } from '@/lib/db';
import { getFreshSessionUser, isInternal } from '@/lib/auth';
import { requireEngineeringAction } from '@/lib/action-permissions';
import { audit } from '@/lib/usb';

// BOM workspace Phase 2 — junction CRUD for bom_assembly_drawings. Read access mirrors
// bom-assemblies' own GET (isInternal); write access reuses engineering.assembly.add, same
// reasoning as the PATCH route (a link/unlink is an edit to the resource that key already
// governs, not a new capability class).
export async function GET(req, { params }) {
  const user = await getFreshSessionUser();
  if (!isInternal(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const rows = await queryAll(
    `SELECT ad.id AS link_id, ad.linked_at, d.id, d.dg_no, d.name, d.status, d.revision
       FROM bom_assembly_drawings ad JOIN calc_drawings d ON d.id = ad.drawing_id
      WHERE ad.assembly_id = ? ORDER BY ad.linked_at DESC`, [params.id]);
  return NextResponse.json(rows);
}

export async function POST(req, { params }) {
  const user = await getFreshSessionUser();
  const actionDenied = await requireEngineeringAction(user, 'engineering.assembly.add');
  if (actionDenied) return actionDenied;

  const b = await req.json();
  if (!b.drawing_id) return NextResponse.json({ error: 'drawing_id is required' }, { status: 400 });

  const assembly = await queryOne('SELECT id, project_id, name FROM bom_assemblies WHERE id = ?', [params.id]);
  if (!assembly) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const drawing = await queryOne('SELECT id, project_id, name FROM calc_drawings WHERE id = ?', [b.drawing_id]);
  if (!drawing || drawing.project_id !== assembly.project_id) {
    return NextResponse.json({ error: 'Drawing not found on this project' }, { status: 400 });
  }

  const existing = await queryOne(
    'SELECT id FROM bom_assembly_drawings WHERE assembly_id = ? AND drawing_id = ?', [params.id, b.drawing_id]);
  if (!existing) {
    await execute(
      'INSERT INTO bom_assembly_drawings (assembly_id, drawing_id, linked_by) VALUES (?, ?, ?)',
      [params.id, b.drawing_id, user.username]
    );
    await audit('bom_assembly_drawing_link', { actor: user.username, detail: `${assembly.name} <- ${drawing.name}` });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(req, { params }) {
  const user = await getFreshSessionUser();
  const actionDenied = await requireEngineeringAction(user, 'engineering.assembly.add');
  if (actionDenied) return actionDenied;

  const drawingId = new URL(req.url).searchParams.get('drawing_id');
  if (!drawingId) return NextResponse.json({ error: 'drawing_id is required' }, { status: 400 });

  await execute('DELETE FROM bom_assembly_drawings WHERE assembly_id = ? AND drawing_id = ?', [params.id, drawingId]);
  await audit('bom_assembly_drawing_unlink', { actor: user.username, detail: `assembly ${params.id} <- drawing ${drawingId}` });
  return NextResponse.json({ ok: true });
}
