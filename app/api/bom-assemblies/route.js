// app/api/bom-assemblies/route.js — STERP item 16, Multi-Level BOM (SYSTEM.md §5o). Same gating
// shape as app/api/bom-items/route.js: Engineering (+PM) own assembly structure, department +
// action gate, not field-level (there's no other department's column on this table).
import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, requireDepartment, isInternal } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { getBomStructure } from '@/lib/data';
import { audit } from '@/lib/usb';

export async function GET(req) {
  const user = await getFreshSessionUser();
  if (!isInternal(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const projectId = new URL(req.url).searchParams.get('project_id');
  if (!projectId) return NextResponse.json({ error: 'project_id is required' }, { status: 400 });
  return NextResponse.json(await getBomStructure(Number(projectId)));
}

export async function POST(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Engineering');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Engineering', 'engineering.assembly.add');
  if (actionDenied) return actionDenied;

  const b = await req.json();
  const name = String(b.name || '').trim();
  if (!b.project_id) return NextResponse.json({ error: 'Project is required' }, { status: 400 });
  if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 });

  if (b.parent_id) {
    const parent = await queryOne('SELECT id, project_id FROM bom_assemblies WHERE id = ?', [b.parent_id]);
    if (!parent || parent.project_id !== Number(b.project_id)) {
      return NextResponse.json({ error: 'Parent assembly not found on this project' }, { status: 400 });
    }
  }

  const { lastId } = await execute(
    `INSERT INTO bom_assemblies (project_id, parent_id, name, qty, created_by) VALUES (?, ?, ?, ?, ?)`,
    [b.project_id, b.parent_id || null, name, Number(b.qty) > 0 ? Number(b.qty) : 1, user.username]
  );
  await audit('bom_assembly_add', { actor: user.username, detail: `project ${b.project_id}: ${name}` });
  return NextResponse.json({ id: Number(lastId) });
}
