import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { audit } from '@/lib/usb';

// Create a Form III A group (real sample SB-1097's "Feed pipeline" — a per-named-sub-assembly
// certificate, distinct from Form IV A's full parts table; see lib/qc-folder-pdf.js). Seeded from a
// BOM assembly_id or group_label (the editor's picker) so a later "Sync from BOM" can auto-pull that
// grouping's material lines (lib/qc-bom-sync.js's matchIiiaGroup) — both optional, a group can also
// be built by hand-moving already-synced Form IV A parts into it via the parts sub-route.
export async function POST(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'QC');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'QC', 'qc.document.write');
  if (actionDenied) return actionDenied;

  const doc = await queryOne('SELECT id FROM qc_documents WHERE id = ?', [params.id]);
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const b = await req.json();
  if (!String(b.name || '').trim()) {
    return NextResponse.json({ error: 'Group name is required' }, { status: 400 });
  }

  const max = await queryOne('SELECT MAX(sort_order) AS n FROM qc_iiia_groups WHERE document_id = ?', [params.id]);
  const sortOrder = (max?.n ?? -1) + 1;

  const res = await execute(
    `INSERT INTO qc_iiia_groups (document_id, name, assembly_id, group_label, sort_order)
     VALUES (?, ?, ?, ?, ?)`,
    [params.id, b.name.trim(), b.assembly_id || null, b.group_label?.trim() || null, sortOrder]);

  await audit('qc_iiia_group_add', {
    actor: user.username,
    detail: JSON.stringify({ qc_document_id: Number(params.id), group_id: Number(res.lastId), name: b.name.trim() }),
  });
  return NextResponse.json({ id: Number(res.lastId) });
}
