// app/api/scope-of-supply/route.js — the confirmed order's handoff to Design/Engineering,
// replacing DesignPanel.jsx's inert "awaiting Work Order / Scope of Supply format" placeholder.
// One row is auto-created on project creation when a sale_order_id is set (app/api/projects/
// route.js); this route covers manual add (for projects that predate this, or a second WO) and
// listing by project. Shared by Design and Engineering — same work order, not department-split.
import { NextResponse } from 'next/server';
import { execute, queryAll } from '@/lib/db';
import { getFreshSessionUser, isInternal, canAccessDepartment } from '@/lib/auth';

function canEditScope(user) {
  return canAccessDepartment(user, 'Design') || canAccessDepartment(user, 'Engineering');
}

export async function GET(req) {
  const user = await getFreshSessionUser();
  if (!isInternal(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const projectId = new URL(req.url).searchParams.get('project_id');
  if (!projectId) return NextResponse.json({ error: 'project_id is required' }, { status: 400 });
  return NextResponse.json(await queryAll('SELECT * FROM scope_of_supply WHERE project_id = ? ORDER BY created_at', [projectId]));
}

// Manual add — a second work order, or the first one for a project that predates the auto-created
// header (a direct-created project with no sale_order_id). Header only; items are added via
// /api/scope-of-supply/[id]/items once the document exists.
export async function POST(req) {
  const user = await getFreshSessionUser();
  if (!canEditScope(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const b = await req.json();
  const title = String(b.title || '').trim();
  if (!title) return NextResponse.json({ error: 'Title is required' }, { status: 400 });
  if (!b.project_id) return NextResponse.json({ error: 'project_id is required' }, { status: 400 });
  const { lastId } = await execute(
    'INSERT INTO scope_of_supply (project_id, title, created_by) VALUES (?, ?, ?)',
    [b.project_id, title, user.username]
  );
  return NextResponse.json({ id: Number(lastId) });
}
