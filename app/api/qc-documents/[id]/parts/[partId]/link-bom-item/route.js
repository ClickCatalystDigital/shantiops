import { NextResponse } from 'next/server';
import { execute, queryOne, withTransaction } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { audit } from '@/lib/usb';
import { reconcileIiiaGroups } from '@/lib/qc-bom-sync';

// Links a QC part to a BOM line so lib/tc-match.js has a real material spec to suggest certificates
// against — see the plan's Step 1. Purely a lookup link, doesn't touch test_certificate_id.
export async function POST(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'QC');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'QC', 'qc.document.write');
  if (actionDenied) return actionDenied;

  const document = await queryOne('SELECT id, project_id FROM qc_documents WHERE id = ?', [params.id]);
  if (!document) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const part = await queryOne('SELECT id FROM qc_document_parts WHERE id = ? AND document_id = ?', [params.partId, params.id]);
  if (!part) return NextResponse.json({ error: 'Part not found on this document' }, { status: 404 });

  const b = await req.json();
  let bomItemId = null;
  if (b.bom_item_id != null) {
    // Must belong to the same project — a part can't be pointed at another job's BOM line.
    const bomItem = await queryOne('SELECT id FROM bom_items WHERE id = ? AND project_id = ?', [b.bom_item_id, document.project_id]);
    if (!bomItem) return NextResponse.json({ error: 'BOM item not found on this project' }, { status: 404 });
    bomItemId = bomItem.id;
  }

  // part_name (optional) — the editor's title field is now the same searchable BOM picker as the
  // link itself (picking a BOM item IS naming the part), so the two are set together in one call
  // rather than needing a second endpoint just to rename.
  if (typeof b.part_name === 'string' && b.part_name.trim()) {
    await execute('UPDATE qc_document_parts SET bom_item_id = ?, part_name = ? WHERE id = ?', [bomItemId, b.part_name.trim(), part.id]);
  } else {
    await execute('UPDATE qc_document_parts SET bom_item_id = ? WHERE id = ?', [bomItemId, part.id]);
  }

  // A manually-linked part deserves the same Form III A group routing "Sync from BOM" already gives
  // an auto-inserted one — otherwise linking a part to a BOM line that belongs to an existing group
  // leaves it stranded on Form IV A until the next full sync happens to touch it.
  if (bomItemId) await withTransaction(tx => reconcileIiiaGroups(tx, params.id));

  await audit('qc_document_part_link_bom_item', {
    actor: user.username,
    detail: JSON.stringify({ qc_document_id: Number(params.id), part_id: Number(params.partId), bom_item_id: bomItemId }),
  });
  return NextResponse.json({ ok: true });
}
