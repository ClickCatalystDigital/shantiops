import { NextResponse } from 'next/server';
import { execute, queryOne, withTransaction } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { audit } from '@/lib/usb';
import { reconcileIiiaGroups } from '@/lib/qc-bom-sync';

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

  // matchIiiaGroup (lib/qc-bom-sync.js) picks the FIRST group matching a given assembly_id/
  // group_label — a second group silently keyed the same way would never receive any auto-synced
  // part, with no error to explain why. Reject up front instead of shipping a group that can never work.
  if (b.assembly_id) {
    const dupe = await queryOne('SELECT name FROM qc_iiia_groups WHERE document_id = ? AND assembly_id = ?', [params.id, b.assembly_id]);
    if (dupe) return NextResponse.json({ error: `"${dupe.name}" already uses this BOM assembly` }, { status: 400 });
  }
  if (b.group_label) {
    const dupe = await queryOne('SELECT name FROM qc_iiia_groups WHERE document_id = ? AND group_label = ?', [params.id, b.group_label.trim()]);
    if (dupe) return NextResponse.json({ error: `"${dupe.name}" already uses this BOM group label` }, { status: 400 });
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

  // Claim any already-synced Form IV A parts that match this group's assembly_id/group_label right
  // away — otherwise a document whose parts were synced before this group existed would show nothing
  // here until a separate "Sync from BOM" click (see lib/qc-bom-sync.js's own comment on this).
  const moved = (b.assembly_id || b.group_label)
    ? await withTransaction(tx => reconcileIiiaGroups(tx, params.id))
    : 0;

  return NextResponse.json({ id: Number(res.lastId), moved });
}
