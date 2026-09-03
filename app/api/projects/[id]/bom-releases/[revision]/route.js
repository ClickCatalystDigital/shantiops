// app/api/projects/[id]/bom-releases/[revision]/route.js — BOM workspace round 2, §7. Returns one
// past release's frozen tree (bom_release_snapshots), parsed. Viewing a past release is not a more
// sensitive action than viewing the live tree, so this stays at the same isInternal read-access
// level as the rest of the BOM workspace — no new permission gate.
import { NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import { getFreshSessionUser, isInternal } from '@/lib/auth';

export async function GET(req, { params }) {
  const user = await getFreshSessionUser();
  if (!isInternal(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const snapshot = await queryOne(
    'SELECT revision, assemblies_json, unassigned_json, created_by, created_at FROM bom_release_snapshots WHERE project_id = ? AND revision = ?',
    [params.id, params.revision]
  );
  if (!snapshot) return NextResponse.json({ error: 'No snapshot for this revision' }, { status: 404 });

  return NextResponse.json({
    revision: snapshot.revision,
    createdBy: snapshot.created_by,
    createdAt: snapshot.created_at,
    assemblies: JSON.parse(snapshot.assemblies_json),
    unassignedItems: JSON.parse(snapshot.unassigned_json),
  });
}
