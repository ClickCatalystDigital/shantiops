// app/api/bom-structure-templates/route.js — Structure Templates (hierarchy-level BOM templates).
// A different job from bom_templates (flat, single-list): this templates a whole subtree captured
// off a real node's own children. CRUD shape mirrors app/api/bom-templates/route.js's own
// GET/POST — same auth, same list-with-counts idiom — content itself is a JSON blob rather than a
// child items table; node_count/item_count are stamped, not read live, so listing stays one query.
import { NextResponse } from 'next/server';
import { execute, queryAll } from '@/lib/db';
import { getFreshSessionUser } from '@/lib/auth';
import { requireEngineeringAction } from '@/lib/action-permissions';
import { NODE_TYPE_SUGGESTIONS } from '@/lib/bom-tree.mjs';
import { computeTemplateCounts } from '@/lib/bom-structure.mjs';

export async function GET(req) {
  const user = await getFreshSessionUser();
  const denied = await requireEngineeringAction(user, 'engineering.assembly.add');
  if (denied) return denied;
  const url = new URL(req.url);
  const level = url.searchParams.get('level');
  const series = url.searchParams.get('series');
  const where = [];
  const args = [];
  if (level) { where.push('level = ?'); args.push(level); }
  if (series) { where.push('(series = ? OR series IS NULL)'); args.push(series); }
  const templates = await queryAll(
    `SELECT id, name, level, series, description, node_count, item_count, root_count, is_default, source_project_no, created_by, created_at
       FROM bom_structure_templates
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY is_default DESC, name`,
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
