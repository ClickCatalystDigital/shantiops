// Explicit "Release BOM" action (Requests' Release BOM tab) — release_bom is a whole-project
// event ("all items released together"), not something to infer from the first item landing on
// the BOM (a project's BOM is usually built up piecemeal over days). This is the deliberate,
// single action that marks it done, distinct from lib/milestone-auto.js's data-inferred triggers.
import { NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import { getFreshSessionUser, canAccessDepartment } from '@/lib/auth';
import { markMilestoneDone } from '@/lib/milestone-auto';
import { audit } from '@/lib/usb';

function canRelease(user) {
  return canAccessDepartment(user, 'Design') || canAccessDepartment(user, 'Engineering');
}

// Status check for the Release BOM tab — full BOM count (not the Received/In-Stock-only view
// /api/projects/[id]/bom now returns for Production/Stores) plus whether release_bom is already
// marked done.
export async function GET(req, { params }) {
  const user = await getFreshSessionUser();
  if (!canRelease(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const bomCount = await queryOne('SELECT COUNT(*) AS n FROM bom_items WHERE project_id = ?', [params.id]);
  const milestone = await queryOne(
    `SELECT status, actual_end FROM milestones WHERE project_id = ? AND milestone_key = 'release_bom'`,
    [params.id]
  );
  const released = !!(milestone?.actual_end || milestone?.status === 'done');
  return NextResponse.json({ bomCount: bomCount?.n || 0, released });
}

export async function POST(req, { params }) {
  const user = await getFreshSessionUser();
  if (!canRelease(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const project = await queryOne('SELECT id FROM projects WHERE id = ?', [params.id]);
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  const bomCount = await queryOne('SELECT COUNT(*) AS n FROM bom_items WHERE project_id = ?', [params.id]);
  if (!bomCount.n) return NextResponse.json({ error: 'This project has no BOM items yet' }, { status: 400 });

  await markMilestoneDone(params.id, 'release_bom', user.username);
  await audit('bom_released', { actor: user.username, detail: `project ${params.id} · ${bomCount.n} item(s)` });
  return NextResponse.json({ ok: true });
}
