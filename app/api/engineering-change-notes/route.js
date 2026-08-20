// app/api/engineering-change-notes/route.js — STERP item 19 (SYSTEM.md §5o), the "release/approval
// workflow for BOM revisions" §5a's v1 explicitly deferred. Raising an ECN is any Engineering
// member; approving/rejecting is Head-only (engineering.ecn.approve is seeded requires_head=1 in
// lib/db.js — a Member self-approving their own change note would defeat the point of the record).
import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, requireDepartment, isInternal } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { getEngineeringChangeNotes } from '@/lib/data';
import { audit } from '@/lib/usb';
import { BOM_FIELD_OWNERS } from '@/lib/bom-fields.mjs';

export async function GET(req) {
  const user = await getFreshSessionUser();
  if (!isInternal(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const projectId = new URL(req.url).searchParams.get('project_id');
  return NextResponse.json(await getEngineeringChangeNotes(projectId ? Number(projectId) : null));
}

export async function POST(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Engineering');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Engineering', 'engineering.ecn.raise');
  if (actionDenied) return actionDenied;

  const b = await req.json();
  const reason = String(b.reason || '').trim();
  const fieldChanged = String(b.field_changed || '').trim();
  if (!b.project_id) return NextResponse.json({ error: 'Project is required' }, { status: 400 });
  if (!fieldChanged) return NextResponse.json({ error: 'Field changed is required' }, { status: 400 });
  // Whitelisted against BOM_FIELD_OWNERS.Engineering — this becomes a raw column name in the
  // approval route's UPDATE, same trust boundary bom-items' own PATCH route enforces.
  if (b.bom_item_id && !BOM_FIELD_OWNERS.Engineering.includes(fieldChanged)) {
    return NextResponse.json({ error: `Not a recognized BOM field: ${fieldChanged}` }, { status: 400 });
  }
  if (!reason) return NextResponse.json({ error: 'Reason is required' }, { status: 400 });

  const project = await queryOne('SELECT id FROM projects WHERE id = ?', [b.project_id]);
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

  const { lastId } = await execute(
    `INSERT INTO bom_change_notes (project_id, bom_item_id, field_changed, old_value, new_value, reason, requested_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [b.project_id, b.bom_item_id || null, fieldChanged, b.old_value || null, b.new_value || null, reason, user.username]
  );
  await audit('bom_change_note_raised', { actor: user.username, detail: `project ${b.project_id}: ${fieldChanged}` });
  return NextResponse.json({ id: Number(lastId) });
}
