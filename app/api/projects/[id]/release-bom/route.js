// Explicit "Release BOM" action (Requests' Release BOM tab) — release_bom is a whole-project
// event ("all items released together"), not something to infer from the first item landing on
// the BOM (a project's BOM is usually built up piecemeal over days). This is the deliberate,
// single action that marks it done, distinct from lib/milestone-auto.js's data-inferred triggers.
import { NextResponse } from 'next/server';
import { queryOne, queryAll, execute } from '@/lib/db';
import { getFreshSessionUser, canAccessDepartment } from '@/lib/auth';
import { markMilestoneDone } from '@/lib/milestone-auto';
import { matchProjectBom } from '@/lib/remnant-match';
import { audit } from '@/lib/usb';

function canRelease(user) {
  return canAccessDepartment(user, 'Design') || canAccessDepartment(user, 'Engineering');
}

// Status check for the Release BOM tab — full BOM count (not the Received/In-Stock-only view
// /api/projects/[id]/bom now returns for Production/Stores) plus whether release_bom is already
// marked done. drawingLinked/nextRevision feed the pre-release readiness summary — informational
// only, never a hard gate (not every line needs a drawing — a bought valve doesn't).
export async function GET(req, { params }) {
  const user = await getFreshSessionUser();
  if (!canRelease(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const bomCount = await queryOne('SELECT COUNT(*) AS n FROM bom_items WHERE project_id = ?', [params.id]);
  const drawingLinked = await queryOne('SELECT COUNT(*) AS n FROM bom_items WHERE project_id = ? AND drawing_id IS NOT NULL', [params.id]);
  const project = await queryOne('SELECT bom_release_revision FROM projects WHERE id = ?', [params.id]);
  const milestone = await queryOne(
    `SELECT id, status, actual_end FROM milestones WHERE project_id = ? AND milestone_key = 'release_bom'`,
    [params.id]
  );
  // "Which templates are on this project" — direct answer to "I don't see a way to verify which
  // templates were added" (per-item detail is the same tpl.name join BomTable already shows).
  const templatesApplied = await queryAll(
    `SELECT tpl.name, COUNT(*) AS n FROM bom_items b JOIN bom_templates tpl ON tpl.id = b.template_id
      WHERE b.project_id = ? GROUP BY tpl.id ORDER BY MIN(b.id)`,
    [params.id]
  );
  const released = !!(milestone?.actual_end || milestone?.status === 'done');
  return NextResponse.json({
    bomCount: bomCount?.n || 0, drawingLinked: drawingLinked?.n || 0, released,
    nextRevision: (project?.bom_release_revision || 0) + 1,
    milestoneId: milestone?.id || null, templatesApplied,
  });
}

export async function POST(req, { params }) {
  const user = await getFreshSessionUser();
  if (!canRelease(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const project = await queryOne('SELECT id, bom_release_revision FROM projects WHERE id = ?', [params.id]);
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  const bomCount = await queryOne('SELECT COUNT(*) AS n FROM bom_items WHERE project_id = ?', [params.id]);
  if (!bomCount.n) return NextResponse.json({ error: 'This project has no BOM items yet' }, { status: 400 });

  // Release-baseline revision — the "Released BOM revision" Production/QC/Procurement can point at
  // (§5k addendum). One counter bump + one stamp of every live line, not a new workflow.
  const revision = (project.bom_release_revision || 0) + 1;
  await execute('UPDATE projects SET bom_release_revision = ? WHERE id = ?', [revision, params.id]);
  await execute('UPDATE bom_items SET released_at_revision = ? WHERE project_id = ?', [revision, params.id]);

  await markMilestoneDone(params.id, 'release_bom', user.username);
  await audit('bom_released', { actor: user.username, detail: `project ${params.id} · ${bomCount.n} item(s) · revision ${revision}` });

  // Cutting & Remnant Management — check every dimensional line against available stock/remnants
  // the moment Design's release makes them real demand. Best-effort: a matching failure here must
  // never block the release itself (already recorded above), same "best-effort, try/catch" stance
  // notifyDepartment calls take throughout this codebase.
  let matched = [];
  try { matched = await matchProjectBom(params.id, user.username); } catch (err) { /* best-effort */ }

  return NextResponse.json({ ok: true, remnantMatches: matched.length, revision });
}
