import { NextResponse } from 'next/server';
import { execute, queryOne, queryAll } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { audit } from '@/lib/usb';
import { getAllocationMode } from '@/lib/procurement';

// BOM workspace Phase 2 — recursively clones a node, its descendants, and their linked bom_items.
// The clone lands as a new sibling of the source (same parent_id), appended after existing
// siblings. Document links are deliberately NOT copied (bom_assembly_drawings/calc_sheets rows,
// and even a cloned item's own single drawing_id reset to NULL) — drawings/calcs represent
// reviewed engineering evidence tied to the original branch, not structural data, so the clone
// starts at 0 drawings/0 calcs and the engineer attaches whatever actually applies. Procurement
// state resets too (fresh 'Enquiry', no pr_ref/po_ref/receipt fields) since a clone's items have no
// purchasing history of their own. Deliberately does not run remnant-match auto-matching on the
// cloned items — out of scope for "duplicate the structure," not a stated requirement.
export async function POST(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Engineering');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Engineering', 'engineering.assembly.add');
  if (actionDenied) return actionDenied;

  const source = await queryOne('SELECT * FROM bom_assemblies WHERE id = ?', [params.id]);
  if (!source) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const all = await queryAll('SELECT * FROM bom_assemblies WHERE project_id = ?', [source.project_id]);
  const childrenByParent = new Map();
  for (const a of all) {
    if (!childrenByParent.has(a.parent_id)) childrenByParent.set(a.parent_id, []);
    childrenByParent.get(a.parent_id).push(a);
  }
  const subtree = [];
  (function collect(node) {
    subtree.push(node);
    for (const child of childrenByParent.get(node.id) || []) collect(child);
  })(source);

  const siblingMax = await queryOne(
    source.parent_id == null
      ? 'SELECT MAX(sort_order) AS m FROM bom_assemblies WHERE project_id = ? AND parent_id IS NULL'
      : 'SELECT MAX(sort_order) AS m FROM bom_assemblies WHERE project_id = ? AND parent_id = ?',
    source.parent_id == null ? [source.project_id] : [source.project_id, source.parent_id]
  );
  const nextRootSort = (siblingMax?.m ?? -1) + 1;

  const idMap = new Map(); // old assembly id -> new assembly id
  let newRootId = null;
  for (const node of subtree) {
    const isRoot = node.id === source.id;
    const newParentId = isRoot ? source.parent_id : idMap.get(node.parent_id);
    const { lastId } = await execute(
      'INSERT INTO bom_assemblies (project_id, parent_id, name, qty, sort_order, node_type, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [node.project_id, newParentId, isRoot ? `${node.name} (Copy)` : node.name, node.qty,
        isRoot ? nextRootSort : node.sort_order, node.node_type, user.username]
    );
    idMap.set(node.id, Number(lastId));
    if (isRoot) newRootId = Number(lastId);
  }

  const oldIds = subtree.map(n => n.id);
  const items = await queryAll(
    `SELECT * FROM bom_items WHERE assembly_id IN (${oldIds.map(() => '?').join(',')})`, oldIds);

  let clonedItemCount = 0;
  if (items.length) {
    const allocationMode = await getAllocationMode();
    const pendingReview = allocationMode === 'manual' ? 1 : 0;
    const maxSort = await queryOne('SELECT MAX(sort_order) AS m FROM bom_items WHERE project_id = ?', [source.project_id]);
    let n = (maxSort?.m ?? -1) + 1;
    for (const it of items) {
      await execute(
        `INSERT INTO bom_items (project_id, assembly_id, sort_order, material_description, moc, size_spec, make, qty_text,
          section, group_label, remarks, category, category_fields_json, named_parts_json, item_id,
          requires_heat_no, requires_mtc, requires_supplier_batch, requires_serial_no, requires_manufacturing,
          purchase_status, pending_review, drawing_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Enquiry', ?, NULL)`,
        [source.project_id, idMap.get(it.assembly_id), n++, it.material_description, it.moc, it.size_spec, it.make, it.qty_text,
          it.section, it.group_label, it.remarks, it.category, it.category_fields_json, it.named_parts_json, it.item_id,
          it.requires_heat_no, it.requires_mtc, it.requires_supplier_batch, it.requires_serial_no, it.requires_manufacturing,
          pendingReview]
      );
      clonedItemCount++;
    }
  }

  await audit('bom_assembly_duplicate', {
    actor: user.username,
    detail: `project ${source.project_id}: duplicated ${source.name} -> ${subtree.length} node(s), ${clonedItemCount} item(s)`,
  });
  return NextResponse.json({ id: newRootId, nodeCount: subtree.length, itemCount: clonedItemCount });
}
