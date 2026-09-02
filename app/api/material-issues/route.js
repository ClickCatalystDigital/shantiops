// app/api/material-issues/route.js — Stores -> WIP material issue. Feature B (Material Indent hard
// gate, 2026-09-02): Production can no longer reach this endpoint at all — canIssue() is Stores-only
// now. A Production request must go through a Material Indent instead
// (POST /api/material-indents/[id]/items/[itemId]/release, which calls issueMaterial() below with
// the Stores user who released it). The actual insert/decrement/GL-posting logic lives in
// lib/material-issues.js, shared by both entry points.
import { NextResponse } from 'next/server';
import { queryAll, queryOne } from '@/lib/db';
import { getFreshSessionUser, canAccessDepartment } from '@/lib/auth';
import { issueMaterial } from '@/lib/material-issues';

function canIssue(user) {
  return canAccessDepartment(user, 'Stores');
}

export async function GET(req) {
  const user = await getFreshSessionUser();
  if (!canIssue(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const params = new URL(req.url).searchParams;
  const bomItemId = params.get('bom_item_id');
  const projectId = params.get('project_id');
  if (bomItemId) {
    return NextResponse.json(await queryAll(
      'SELECT * FROM material_issues WHERE bom_item_id = ? ORDER BY issued_at DESC', [bomItemId]
    ));
  }
  if (projectId) {
    return NextResponse.json(await queryAll(
      `SELECT mi.*, b.material_description, b.moc, b.size_spec
         FROM material_issues mi JOIN bom_items b ON b.id = mi.bom_item_id
        WHERE b.project_id = ? ORDER BY mi.issued_at DESC LIMIT 100`,
      [projectId]
    ));
  }
  return NextResponse.json({ error: 'bom_item_id or project_id is required' }, { status: 400 });
}

export async function POST(req) {
  const user = await getFreshSessionUser();
  if (!canIssue(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const b = await req.json();
  const bomItemId = Number(b.bom_item_id);
  const qty = Number(b.qty);
  const jobCardId = b.job_card_id ? Number(b.job_card_id) : null;
  const notes = String(b.notes || '').trim() || null;

  try {
    const result = await issueMaterial({ bomItemId, qty, jobCardId, notes, username: user.username });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
