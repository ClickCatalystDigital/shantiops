// Explicit "Release BOM" action (Requests' Release BOM tab) — release_bom is a whole-project
// event ("all items released together"), not something to infer from the first item landing on
// the BOM (a project's BOM is usually built up piecemeal over days). This is the deliberate,
// single action that marks it done, distinct from lib/milestone-auto.js's data-inferred triggers.
import { NextResponse } from 'next/server';
import { queryOne, queryAll, execute } from '@/lib/db';
import { getFreshSessionUser, canAccessDepartment } from '@/lib/auth';
import { markMilestoneDone } from '@/lib/milestone-auto';
import { matchProjectBom } from '@/lib/remnant-match';
import { getAllocationMode, matchProjectPlainStock, notifyProcurementIfShortfall } from '@/lib/procurement';
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
  // Drawing-revision snapshot (Phase 1, 20.1) — calc_drawings.revision is a single mutable field on
  // the drawing's own row, not a history table; without this, a later drawing revision would
  // silently rewrite what an already-released line appears to have been driven by. A point-in-time
  // copy taken at the exact moment the line's own release baseline is stamped above — never a live
  // join, so "which drawing revision required this material" stays answerable no matter how many
  // times the drawing itself is revised afterward.
  await execute(
    `UPDATE bom_items SET drawing_revision_at_release = (SELECT revision FROM calc_drawings WHERE calc_drawings.id = bom_items.drawing_id)
      WHERE project_id = ? AND drawing_id IS NOT NULL`,
    [params.id]
  );

  await markMilestoneDone(params.id, 'release_bom', user.username);
  await audit('bom_released', { actor: user.username, detail: `project ${params.id} · ${bomCount.n} item(s) · revision ${revision}` });

  // Cutting & Remnant Management — check every dimensional line against available stock/remnants
  // the moment Design's release makes them real demand. Best-effort: a matching failure here must
  // never block the release itself (already recorded above), same "best-effort, try/catch" stance
  // notifyDepartment calls take throughout this codebase.
  let matched = [];
  try { matched = await matchProjectBom(params.id, user.username); } catch (err) { /* best-effort */ }

  // Auto mode's plain-stock counterpart — the moment the release makes every line real demand,
  // the same "check available inventory first" pass runs for ordinary catalog-linked lines, not
  // just dimensional ones. Manual mode: every fresh line is already pending_review=1 (see the
  // import/add routes), so this naturally finds nothing to do — no mode check needed here.
  let plainMatched = [];
  try { plainMatched = await matchProjectPlainStock(params.id, user.username); } catch (err) { /* best-effort */ }

  // Task §17's "Procurement receives a new shortage" — one notification per line that's actually
  // visible to Procurement post-match (pending_review=0), covering all three AUTO outcomes: a
  // partial-match shortfall, a fully-unmatched line, or (via the function's own dedupe_key) simply
  // a no-op repeat on a line already notified by an earlier release/edit.
  try {
    const openLines = await queryAll(
      `SELECT id FROM bom_items WHERE project_id = ? AND source = 'bom' AND pending_review = 0
         AND COALESCE(purchase_status, 'Enquiry') NOT IN ('Received','Cancelled','In-Stock')`,
      [params.id]
    );
    for (const line of openLines) await notifyProcurementIfShortfall(line.id);
  } catch (err) { /* best-effort */ }

  return NextResponse.json({ ok: true, remnantMatches: matched.length, autoReserved: plainMatched.length, revision });
}
