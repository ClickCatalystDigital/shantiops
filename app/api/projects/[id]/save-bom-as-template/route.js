import { NextResponse } from 'next/server';
import { execute, queryOne, queryAll } from '@/lib/db';
import { getFreshSessionUser } from '@/lib/auth';
import { requireEngineeringAction } from '@/lib/action-permissions';
import { audit } from '@/lib/usb';
import { buildTemplateTree, computeTemplateCounts } from '@/lib/bom-structure.mjs';

// Captures a project's ENTIRE current top-level tree (every root node + full descendants) as one
// Structure Template, rather than one node at a time — "save this whole BOM as a reusable package."
// Reuses buildTemplateTree/computeTemplateCounts exactly as-is (both already accept/produce
// multi-root JSON — nothing about them assumed a single root, that was only ever a choice at the
// call site), and the apply side (insertTemplateTree/flattenTemplateTree) already walks a multi-root
// tree_json correctly with zero changes, since "Build from Templates" was always designed to insert
// several new top-level roots in one batch call. `level` is always 'System' — a whole-BOM template
// only ever makes sense applied at the project root, the same bucket single-System templates use, so
// it shows up in the exact same "Build from Templates" picker (client distinguishes it there by its
// own >1 root count, no new column needed).
export async function POST(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = await requireEngineeringAction(user, 'engineering.assembly.add');
  if (denied) return denied;

  const project = await queryOne('SELECT id, project_no FROM projects WHERE id = ?', [params.id]);
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const b = await req.json();
  // overwrite_template_id = "Update existing template" (the safe way to change a whole-BOM template —
  // the sandbox editor can't, it only tracks one root). Validated up front, before the tree walk.
  // The template keeps its own name/series/description (no UNIQUE(level, series, name) clash risk);
  // only its content, counts, source and version change. Applied BOMs are independent copies and are
  // never touched.
  let overwrite = null;
  if (b.overwrite_template_id) {
    overwrite = await queryOne(
      'SELECT id, name, level, tree_json, version FROM bom_structure_templates WHERE id = ? AND archived_at IS NULL',
      [b.overwrite_template_id]);
    if (!overwrite) return NextResponse.json({ error: 'Template not found' }, { status: 404 });
    if (overwrite.level !== 'System') {
      return NextResponse.json({ error: 'Only whole-BOM (System-level) templates can be updated from a project' }, { status: 400 });
    }
  }
  const name = String(b.name || '').trim();
  if (!overwrite && !name) return NextResponse.json({ error: 'Name is required' }, { status: 400 });

  const all = await queryAll(
    'SELECT id, parent_id, name, node_type, qty FROM bom_assemblies WHERE project_id = ? ORDER BY sort_order, id',
    [params.id]);
  const childrenByParent = new Map();
  for (const a of all) {
    if (!childrenByParent.has(a.parent_id)) childrenByParent.set(a.parent_id, []);
    childrenByParent.get(a.parent_id).push(a);
  }
  const rootNodes = childrenByParent.get(null) || [];
  if (!rootNodes.length) return NextResponse.json({ error: 'This project has no BOM structure yet to save as a template' }, { status: 400 });

  const allIds = all.map(a => a.id);
  const items = allIds.length
    ? await queryAll(
        `SELECT assembly_id, material_description, moc, size_spec, qty_text, make, remarks,
                category, category_fields_json, named_parts_json, item_id,
                requires_heat_no, requires_mtc, requires_supplier_batch, requires_serial_no,
                requires_manufacturing
           FROM bom_items WHERE assembly_id IN (${allIds.map(() => '?').join(',')})
          ORDER BY sort_order, id`,
        allIds)
    : [];
  const itemsByAssembly = new Map();
  for (const it of items) {
    if (!itemsByAssembly.has(it.assembly_id)) itemsByAssembly.set(it.assembly_id, []);
    itemsByAssembly.get(it.assembly_id).push(it);
  }

  const tree = buildTemplateTree(rootNodes, childrenByParent, itemsByAssembly);
  const { nodeCount, itemCount, rootCount } = computeTemplateCounts(tree);

  if (overwrite) {
    // Version +1 only when the content really changed (a no-op re-save must not flag every node built
    // from this template as out of date).
    const changed = overwrite.tree_json !== JSON.stringify(tree);
    await execute(
      `UPDATE bom_structure_templates
          SET tree_json = ?, node_count = ?, item_count = ?, root_count = ?, source_project_no = ?,
              version = version + ${changed ? 1 : 0}
        WHERE id = ?`,
      [JSON.stringify(tree), nodeCount, itemCount, rootCount, `Captured from ${project.project_no}`, overwrite.id]);
    await audit('bom_structure_template_update', {
      actor: user.username,
      detail: `updated whole-BOM template ${overwrite.id} ("${overwrite.name}") from project ${params.id} — v${overwrite.version}${changed ? ` -> v${overwrite.version + 1}` : ' (unchanged)'}, ${rootCount} root(s), ${nodeCount} node(s), ${itemCount} item(s)`,
    });
    return NextResponse.json({
      id: overwrite.id, nodeCount, itemCount, rootCount,
      version: overwrite.version + (changed ? 1 : 0), unchanged: !changed,
    });
  }

  const { lastId } = await execute(
    `INSERT INTO bom_structure_templates
       (name, level, series, description, tree_json, node_count, item_count, root_count, source_project_no, created_by)
     VALUES (?, 'System', ?, ?, ?, ?, ?, ?, ?, ?)`,
    [name, b.series?.trim() || null, b.description?.trim() || null, JSON.stringify(tree),
      nodeCount, itemCount, rootCount, `Captured from ${project.project_no}`, user.username]
  );

  await audit('bom_structure_template_save', {
    actor: user.username,
    detail: `saved whole-BOM template "${name}" from project ${params.id} — ${rootCount} root(s), ${nodeCount} node(s), ${itemCount} item(s)`,
  });
  return NextResponse.json({ id: Number(lastId), nodeCount, itemCount, rootCount });
}
