// app/api/bom-structure-templates/route.js — Structure Templates (hierarchy-level BOM templates).
// A different job from bom_templates (flat, single-list): this templates a whole subtree captured
// off a real node's own children. CRUD shape mirrors app/api/bom-templates/route.js's own
// GET/POST — same auth, same list-with-counts idiom — content itself is a JSON blob rather than a
// child items table; node_count/item_count are stamped, not read live, so listing stays one query.
import { NextResponse } from 'next/server';
import { execute, queryAll } from '@/lib/db';
import { getFreshSessionUser, isInternal } from '@/lib/auth';
import { requireEngineeringAction } from '@/lib/action-permissions';
import { NODE_TYPE_SUGGESTIONS } from '@/lib/bom-tree.mjs';
import { computeTemplateCounts } from '@/lib/bom-structure.mjs';

export async function GET(req) {
  const user = await getFreshSessionUser();
  // ?lite=1 — names only, for the Product Master's "BOM structure template" picker (Sales can pick
  // one without Engineering access; the template content itself stays Engineering-only).
  if (new URL(req.url).searchParams.get('lite') === '1') {
    if (!isInternal(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    return NextResponse.json(await queryAll(
      'SELECT id, name, level, series, root_count FROM bom_structure_templates WHERE archived_at IS NULL ORDER BY name'));
  }
  const denied = await requireEngineeringAction(user, 'engineering.assembly.add');
  if (denied) return denied;
  const url = new URL(req.url);
  const level = url.searchParams.get('level');
  const series = url.searchParams.get('series');
  // Archived templates (deleted while already in use, see DELETE [id]) never show in any list/picker.
  const where = ['t.archived_at IS NULL'];
  const args = [];
  if (level) { where.push('t.level = ?'); args.push(level); }
  if (series) { where.push('(t.series = ? OR t.series IS NULL)'); args.push(series); }
  // used_nodes/used_projects feed the delete dialog's "already used on N nodes" wording (lineage is
  // stamped on root nodes only, bom_assemblies.structure_template_id). Real projects only: the hidden
  // template-sandbox project (is_system) holds throwaway nodes stamped with the template being edited,
  // which are not "a BOM that used it".
  const templates = await queryAll(
    `SELECT t.id, t.name, t.level, t.series, t.description, t.node_count, t.item_count, t.root_count, t.is_default,
            t.source_project_no, t.created_by, t.created_at, t.version,
            (SELECT COUNT(*) FROM bom_assemblies a JOIN projects p ON p.id = a.project_id
              WHERE a.structure_template_id = t.id AND COALESCE(p.is_system, 0) = 0) AS used_nodes,
            (SELECT COUNT(DISTINCT a.project_id) FROM bom_assemblies a JOIN projects p ON p.id = a.project_id
              WHERE a.structure_template_id = t.id AND COALESCE(p.is_system, 0) = 0) AS used_projects
       FROM bom_structure_templates t
      WHERE ${where.join(' AND ')}
      ORDER BY t.is_default DESC, t.name`,
    args
  );
  return NextResponse.json(templates);
}

export async function POST(req) {
  const user = await getFreshSessionUser();
  const denied = await requireEngineeringAction(user, 'engineering.assembly.add');
  if (denied) return denied;
  const b = await req.json();
  const name = String(b.name || '').trim();
  if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 });
  const level = NODE_TYPE_SUGGESTIONS.includes(b.level) ? b.level : NODE_TYPE_SUGGESTIONS[0];
  const treeJson = Array.isArray(b.tree) ? b.tree : [];
  const { nodeCount, itemCount, rootCount } = computeTemplateCounts(treeJson);

  const { lastId } = await execute(
    `INSERT INTO bom_structure_templates
       (name, level, series, description, tree_json, node_count, item_count, root_count, source_project_no, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [name, level, b.series?.trim() || null, b.description?.trim() || null, JSON.stringify(treeJson),
      nodeCount, itemCount, rootCount, b.source_project_no || null, user.username]
  );
  return NextResponse.json({ id: Number(lastId), nodeCount, itemCount });
}
