import { NextResponse } from 'next/server';
import { execute, queryOne, queryAll } from '@/lib/db';
import { getFreshSessionUser } from '@/lib/auth';
import { requireEngineeringAction } from '@/lib/action-permissions';
import { audit } from '@/lib/usb';
import { getAllocationMode } from '@/lib/procurement';
import { flattenTemplateTree } from '@/lib/bom-structure.mjs';

// Inserts a template's tree_json as new children under [id] — the mirror image of duplicate/
// route.js's own insert loop (same idMap pattern), driven by flattenTemplateTree()'s
// parent-before-child list instead of a DB-fetched parent_id map. Always additive: appends after
// the node's existing children, never blocks on the node already having some (unlike
// stage_templates' apply-only-if-empty rule — a BOM node legitimately gets built up from more than
// one template).
export async function POST(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = await requireEngineeringAction(user, 'engineering.assembly.add');
  if (denied) return denied;

  const target = await queryOne('SELECT id, project_id FROM bom_assemblies WHERE id = ?', [params.id]);
  if (!target) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const b = await req.json();
  const template = await queryOne('SELECT * FROM bom_structure_templates WHERE id = ?', [b.template_id]);
  if (!template) return NextResponse.json({ error: 'Template not found' }, { status: 404 });
  let tree = [];
  try { tree = JSON.parse(template.tree_json); } catch { /* treat corrupt data as empty, not a crash */ }

  const result = await insertTemplateTree(tree, target.project_id, target.id, template.id, user.username);

  await audit('bom_assembly_apply_template', {
    actor: user.username,
    detail: `applied template "${template.name}" (${template.id}) onto node ${target.id} — ${result.nodeCount} node(s), ${result.itemCount} item(s)`,
  });
  return NextResponse.json(result);
}

// Shared with app/api/bom-assemblies/apply-templates-to-project/route.js (project-scoped bootstrap
// variant, parentId=null) so the idMap insert logic exists in exactly one place regardless of which
// route calls it.
export async function insertTemplateTree(tree, projectId, parentId, templateId, username) {
  const flat = flattenTemplateTree(tree);
  if (!flat.length) return { rootId: null, nodeCount: 0, itemCount: 0 };

  const siblingMax = await queryOne(
    parentId == null
      ? 'SELECT MAX(sort_order) AS m FROM bom_assemblies WHERE project_id = ? AND parent_id IS NULL'
      : 'SELECT MAX(sort_order) AS m FROM bom_assemblies WHERE project_id = ? AND parent_id = ?',
    parentId == null ? [projectId] : [projectId, parentId]
  );
  let nextSort = (siblingMax?.m ?? -1) + 1;

  const idMap = new Map(); // tempId -> real bom_assemblies id
  let rootId = null;
  for (const entry of flat) {
    const isRoot = entry.tempParentId == null;
    const realParentId = isRoot ? parentId : idMap.get(entry.tempParentId);
    // structure_template_id (lineage) is stamped on root entries only — a template's own top-level
    // node(s), not every descendant it brought along.
    const { lastId } = await execute(
      'INSERT INTO bom_assemblies (project_id, parent_id, name, qty, sort_order, node_type, structure_template_id, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [projectId, realParentId, entry.name, entry.qty, isRoot ? nextSort++ : 0, entry.node_type, isRoot ? templateId : null, username]
    );
    idMap.set(entry.tempId, Number(lastId));
    if (isRoot && rootId == null) rootId = Number(lastId);
  }

  const allocationMode = await getAllocationMode();
  const pendingReview = allocationMode === 'manual' ? 1 : 0;
  const maxItemSort = await queryOne('SELECT MAX(sort_order) AS m FROM bom_items WHERE project_id = ?', [projectId]);
  let n = (maxItemSort?.m ?? -1) + 1;
  let itemCount = 0;
  for (const entry of flat) {
    for (const it of entry.items) {
      if (!it.material_description?.trim()) continue;
      // A template saved long ago may reference a since-deleted catalog row — re-check rather than
      // insert a dangling FK. Silently drops the link, keeps the free-text spec intact.
      let itemId = null;
      if (it.item_id) {
        const catalogRow = await queryOne('SELECT id FROM items WHERE id = ?', [it.item_id]);
        if (catalogRow) itemId = it.item_id;
      }
      await execute(
        `INSERT INTO bom_items (project_id, assembly_id, sort_order, material_description, moc, size_spec, qty_text,
                                 make, remarks, category, category_fields_json, named_parts_json, item_id,
                                 requires_heat_no, requires_mtc, requires_supplier_batch, requires_serial_no,
                                 purchase_status, pending_review)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Enquiry', ?)`,
        [projectId, idMap.get(entry.tempId), n++, it.material_description, it.moc || null, it.size_spec || null,
          it.qty_text || null, it.make || null, it.remarks || null, it.category || null, it.category_fields_json || null,
          it.named_parts_json || null, itemId,
          it.requires_heat_no ? 1 : 0, it.requires_mtc ? 1 : 0, it.requires_supplier_batch ? 1 : 0, it.requires_serial_no ? 1 : 0,
          pendingReview]
      );
      itemCount++;
    }
  }

  return { rootId, nodeCount: flat.length, itemCount };
}
