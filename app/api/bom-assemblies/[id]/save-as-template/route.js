import { NextResponse } from 'next/server';
import { execute, queryOne, queryAll } from '@/lib/db';
import { getFreshSessionUser } from '@/lib/auth';
import { requireEngineeringAction } from '@/lib/action-permissions';
import { audit } from '@/lib/usb';
import { NODE_TYPE_SUGGESTIONS, effectiveNodeLevel } from '@/lib/bom-tree.mjs';
import { buildTemplateTree, computeTemplateCounts } from '@/lib/bom-structure.mjs';

// Captures this NODE ITSELF (its own name/type/qty/items, plus every descendant recursively) as a
// new bom_structure_templates row with one root — "save this branch, starting here." Capturing the
// node's own identity (not just its children) is what lets a bootstrap apply create a real, properly
// named "BOILER" node with its whole structure in one action, rather than scattering the node's
// children as parent-less orphans. `name` in the request body is the TEMPLATE's own title (e.g.
// "Standard 500kg/hr Boiler") — independent of `node.name` (e.g. "BOILER"), which travels inside
// tree_json and is what a future apply actually recreates.
export async function POST(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = await requireEngineeringAction(user, 'engineering.assembly.add');
  if (denied) return denied;

  const node = await queryOne('SELECT * FROM bom_assemblies WHERE id = ?', [params.id]);
  if (!node) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const b = await req.json();
  const name = String(b.name || '').trim();
  if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 });

  // ORDER BY sort_order — a template must preserve the real build order, not whatever order SQLite
  // happens to return; childrenByParent/itemsByAssembly below just push in query order, so the
  // ordering has to be correct at the source.
  const all = await queryAll('SELECT id, parent_id, name, node_type, qty FROM bom_assemblies WHERE project_id = ? ORDER BY sort_order, id', [node.project_id]);
  const byId = new Map(all.map(a => [a.id, a]));
  const childrenByParent = new Map();
  for (const a of all) {
    if (!childrenByParent.has(a.parent_id)) childrenByParent.set(a.parent_id, []);
    childrenByParent.get(a.parent_id).push(a);
  }
  const rootNodes = [node];

  // Collect every id in the captured branch (the node itself + every descendant) to fetch items for.
  const idsForItems = rootNodes.flatMap(function walkIds(r) {
    const kids = childrenByParent.get(r.id) || [];
    return [r.id, ...kids.flatMap(walkIds)];
  });

  const items = idsForItems.length
    ? await queryAll(
        `SELECT assembly_id, material_description, moc, size_spec, qty_text, make, remarks,
                category, category_fields_json, named_parts_json, item_id,
                requires_heat_no, requires_mtc, requires_supplier_batch, requires_serial_no
           FROM bom_items WHERE assembly_id IN (${idsForItems.map(() => '?').join(',')})
          ORDER BY sort_order, id`,
        idsForItems)
    : [];
  const itemsByAssembly = new Map();
  for (const it of items) {
    if (!itemsByAssembly.has(it.assembly_id)) itemsByAssembly.set(it.assembly_id, []);
    itemsByAssembly.get(it.assembly_id).push(it);
  }

  const hasContent = (childrenByParent.get(node.id)?.length || 0) > 0 || (itemsByAssembly.get(node.id)?.length || 0) > 0;
  if (!hasContent) return NextResponse.json({ error: 'This node has no children or items to save as a template' }, { status: 400 });

  const tree = buildTemplateTree(rootNodes, childrenByParent, itemsByAssembly);
  const { nodeCount, itemCount, rootCount } = computeTemplateCounts(tree);
  const level = NODE_TYPE_SUGGESTIONS.includes(b.level) ? b.level : effectiveNodeLevel(node, byId);
  const project = await queryOne('SELECT project_no FROM projects WHERE id = ?', [node.project_id]);
  const sourceProjectNo = project ? `Captured from ${project.project_no}` : null;

  // The sandbox-edit flow's "Update Template" button calls this same route with
  // overwrite_template_id set — same walk above, different final DB op: update the existing row's
  // content in place instead of creating a second one. name/series/description stay whatever the
  // caller sends (the sandbox screen's own header fields), matching the metadata this route already
  // takes for a fresh create.
  if (b.overwrite_template_id) {
    const existing = await queryOne('SELECT id FROM bom_structure_templates WHERE id = ?', [b.overwrite_template_id]);
    if (!existing) return NextResponse.json({ error: 'Template not found' }, { status: 404 });
    // level must be re-saved too, not just content — if the sandbox node's own classification was
    // changed (the Overview tab's "Classified as" selector) before clicking Update Template, the
    // template's advertised level would otherwise silently drift from what its root node actually
    // is, breaking the Overview-tab/bootstrap picker filters that key off this column.
    await execute(
      `UPDATE bom_structure_templates
          SET name = ?, level = ?, series = ?, description = ?, tree_json = ?, node_count = ?, item_count = ?, root_count = ?
        WHERE id = ?`,
      [name, level, b.series?.trim() || null, b.description?.trim() || null, JSON.stringify(tree),
        nodeCount, itemCount, rootCount, b.overwrite_template_id]
    );
    await audit('bom_structure_template_update', {
      actor: user.username,
      detail: `updated template ${b.overwrite_template_id} ("${name}") from sandbox node ${node.id} — ${nodeCount} node(s), ${itemCount} item(s)`,
    });
    return NextResponse.json({ id: Number(b.overwrite_template_id), nodeCount, itemCount });
  }

  const { lastId } = await execute(
    `INSERT INTO bom_structure_templates
       (name, level, series, description, tree_json, node_count, item_count, root_count, source_project_no, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [name, level, b.series?.trim() || null, b.description?.trim() || null, JSON.stringify(tree),
      nodeCount, itemCount, rootCount, sourceProjectNo, user.username]
  );

  await audit('bom_structure_template_save', {
    actor: user.username,
    detail: `saved "${name}" from ${node.name} (node ${node.id}) — ${nodeCount} node(s), ${itemCount} item(s)`,
  });
  return NextResponse.json({ id: Number(lastId), nodeCount, itemCount });
}
