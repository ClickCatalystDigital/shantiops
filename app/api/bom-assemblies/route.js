// app/api/bom-assemblies/route.js — STERP item 16, Multi-Level BOM (SYSTEM.md §5o). Same gating
// shape as app/api/bom-items/route.js: Engineering (+PM) own assembly structure, department +
// action gate, not field-level (there's no other department's column on this table).
import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, isInternal } from '@/lib/auth';
import { requireEngineeringAction } from '@/lib/action-permissions';
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
  const actionDenied = await requireEngineeringAction(user, 'engineering.assembly.add');
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

  // New nodes always append to the end of their sibling list (BOM workspace Phase 2) — never left
  // at the column's default 0, so Move Up/Down never has to break a tie among freshly-created rows.
  const siblingMax = await queryOne(
    b.parent_id
      ? 'SELECT MAX(sort_order) AS m FROM bom_assemblies WHERE project_id = ? AND parent_id = ?'
      : 'SELECT MAX(sort_order) AS m FROM bom_assemblies WHERE project_id = ? AND parent_id IS NULL',
    b.parent_id ? [b.project_id, b.parent_id] : [b.project_id]
  );
  const sortOrder = (siblingMax?.m ?? -1) + 1;

  const { lastId } = await execute(
    `INSERT INTO bom_assemblies (project_id, parent_id, name, qty, sort_order, node_type, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [b.project_id, b.parent_id || null, name, Number(b.qty) > 0 ? Number(b.qty) : 1, sortOrder,
      b.node_type ? String(b.node_type).trim() || null : null, user.username]
  );
  await audit('bom_assembly_add', { actor: user.username, detail: `project ${b.project_id}: ${name}` });
  return NextResponse.json({ id: Number(lastId) });
}
