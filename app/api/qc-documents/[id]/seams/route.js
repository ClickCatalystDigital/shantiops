import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';

const LOCATIONS = ['belt', 'furnace_ring'];

// QC statutory-forms plan, Phase 5 — Form III §4's dynamic belt/furnace-ring seam rows. Mirrors
// app/api/qc-documents/[id]/iiia-groups/route.js's shape exactly. `sequence` auto-increments per
// location (Belt 1, Belt 2, ... independent from Ring 1, Ring 2, ...) so the editor's "+ Add belt"/
// "+ Add furnace ring" buttons need no input beyond which list to append to.
export async function POST(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'QC');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'QC', 'qc.document.write');
  if (actionDenied) return actionDenied;

  const doc = await queryOne('SELECT id FROM qc_documents WHERE id = ?', [params.id]);
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const b = await req.json();
  if (!LOCATIONS.includes(b.location)) {
    return NextResponse.json({ error: 'location must be belt or furnace_ring' }, { status: 400 });
  }

  const max = await queryOne(
    'SELECT MAX(sequence) AS n FROM qc_document_longitudinal_seams WHERE document_id = ? AND location = ?',
    [params.id, b.location]);
  const sequence = (max?.n ?? 0) + 1;

  const res = await execute(
    'INSERT INTO qc_document_longitudinal_seams (document_id, location, sequence) VALUES (?, ?, ?)',
    [params.id, b.location, sequence]);

  return NextResponse.json({ id: Number(res.lastId), location: b.location, sequence, seam_count: null });
}
