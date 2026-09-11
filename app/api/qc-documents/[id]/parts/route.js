import { NextResponse } from 'next/server';
import { execute, queryOne, withTransaction } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { audit } from '@/lib/usb';
import { reconcileIiiaGroups } from '@/lib/qc-bom-sync';

// V2-CHANGES.md Group 2 — add a part row a document's exceptions need beyond the SF template's
// 54-part seed (client point 1: "make it possible to remove or adding new as well to manage
// exceptions"). Starts unlinked, same as every seeded row — the hard PDF gate (qc-documents/[id]/pdf)
// re-checks server-side regardless of how many parts a document ends up with.
//
// bom_item_id (optional) — the editor's AddPartDialog now offers picking an existing BOM line instead
// of a purely free-text add, so a manually-added part can benefit from the same architecture a synced
// one gets: lib/tc-match.js's certificate suggestions, and (below) Form III A group routing.
export async function POST(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'QC');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'QC', 'qc.document.write');
  if (actionDenied) return actionDenied;

  const doc = await queryOne(
    `SELECT qd.id, qd.project_id, p.master_project_id FROM qc_documents qd
       JOIN projects p ON p.id = qd.project_id WHERE qd.id = ?`, [params.id]);
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  // A split child's own BOM items live only on the master (§5k/§5bj) — the editor's "From BOM item"
  // picker already resolves to the master (app/projects/[id]/qc/[docId]/page.js), so this check must
  // match it or every pick on a child document 404s here.
  const bomProjectId = doc.master_project_id || doc.project_id;

  const b = await req.json();
  if (!String(b.part_name || '').trim()) {
    return NextResponse.json({ error: 'Part name is required' }, { status: 400 });
  }

  let bomItemId = null;
  if (b.bom_item_id != null) {
    // Same project-ownership check as link-bom-item — a part can't be pointed at another job's BOM line.
    const bomItem = await queryOne('SELECT id FROM bom_items WHERE id = ? AND project_id = ?', [b.bom_item_id, bomProjectId]);
    if (!bomItem) return NextResponse.json({ error: 'BOM item not found on this project' }, { status: 404 });
    bomItemId = bomItem.id;
  }

  // Optional — lets a part be created directly inside a Form III A group (the editor's own
  // "Add part" button on a group card) instead of always landing ungrouped in Form IV A first.
  let iiiaGroupId = null;
  if (b.iiia_group_id != null) {
    const group = await queryOne('SELECT id FROM qc_iiia_groups WHERE id = ? AND document_id = ?', [b.iiia_group_id, params.id]);
    if (!group) return NextResponse.json({ error: 'Form III A group not found' }, { status: 404 });
    iiiaGroupId = group.id;
  }

  const max = await queryOne('SELECT MAX(sort_order) AS n FROM qc_document_parts WHERE document_id = ?', [params.id]);
  const sortOrder = (max?.n ?? -1) + 1;
  const partName = b.part_name.trim();

  let partId;
  let moved = false;
  try {
    const res = await execute(
      `INSERT INTO qc_document_parts (document_id, part_no, part_name, size_t, size_w, size_l, qty, bom_item_id, sort_order, iiia_group_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [params.id, b.part_no?.trim() || null, partName, b.size_t?.trim() || null,
        b.size_w?.trim() || null, b.size_l?.trim() || null, b.qty?.trim() || null, bomItemId, sortOrder, iiiaGroupId]);
    partId = Number(res.lastId);
  } catch (err) {
    // (document_id, bom_item_id, part_name) is unique so a BOM line's own named-part breakdown can't
    // duplicate — the most common way to hit it here is picking a BOM item "Sync from BOM" already
    // created a Form IV A row for, from a group's own "Add part". Rather than a raw 500, resolve it
    // the way the old "move a Form IV A part into this group" picker used to: reassign that existing,
    // still-ungrouped row into the target group instead of inserting a duplicate.
    if (bomItemId && String(err.message || '').includes('qc_document_parts.document_id, qc_document_parts.bom_item_id, qc_document_parts.part_name')) {
      const existing = await queryOne(
        'SELECT id, iiia_group_id FROM qc_document_parts WHERE document_id = ? AND bom_item_id = ? AND part_name = ?',
        [params.id, bomItemId, partName]);
      if (!existing) throw err;
      if (existing.iiia_group_id != null && existing.iiia_group_id !== iiiaGroupId) {
        return NextResponse.json({ error: `"${partName}" is already in a different Form III A group on this document.` }, { status: 409 });
      }
      if (iiiaGroupId == null) {
        return NextResponse.json({ error: `A part named "${partName}" linked to this BOM item already exists on this document.` }, { status: 409 });
      }
      await execute('UPDATE qc_document_parts SET iiia_group_id = ? WHERE id = ?', [iiiaGroupId, existing.id]);
      partId = existing.id;
      moved = true;
    } else {
      throw err;
    }
  }

  if (bomItemId && !moved) await withTransaction(tx => reconcileIiiaGroups(tx, params.id));

  await audit('qc_document_part_add', {
    actor: user.username,
    detail: JSON.stringify({ qc_document_id: Number(params.id), part_id: partId, part_name: partName, moved_existing: moved }),
  });
  return NextResponse.json({ id: partId, moved });
}
