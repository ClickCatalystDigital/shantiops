import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser } from '@/lib/auth';
import { requireEngineeringAction } from '@/lib/action-permissions';
import { computeTemplateCounts } from '@/lib/bom-structure.mjs';

// GET doubles as the sandbox-edit flow's "load what this template currently holds" — the JSON is
// parsed here once so no caller has to know it's stored as a string.
export async function GET(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = await requireEngineeringAction(user, 'engineering.assembly.add');
  if (denied) return denied;
  const row = await queryOne('SELECT * FROM bom_structure_templates WHERE id = ?', [params.id]);
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  let tree = [];
  try { tree = JSON.parse(row.tree_json); } catch { /* leave empty on corrupt data rather than 500 */ }
  return NextResponse.json({ ...row, tree });
}

// Metadata edit (name/series/description/is_default) is always available; a `tree` in the body is
// optional and, when present, replaces the whole blob — this is what the sandbox-edit flow's
// "Update Template" button calls after re-walking a real node's current children. Never diffed,
// same replace-wholesale philosophy bom_templates' own PATCH already uses.
export async function PATCH(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = await requireEngineeringAction(user, 'engineering.assembly.add');
  if (denied) return denied;
  const existing = await queryOne('SELECT id, level, series FROM bom_structure_templates WHERE id = ?', [params.id]);
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const b = await req.json();

  if (b.is_default) {
    // Scoped the same way the UNIQUE constraint is (level, series) — only one default per that pair.
    await execute('UPDATE bom_structure_templates SET is_default = 0 WHERE level = ? AND (series = ? OR (series IS NULL AND ? IS NULL))',
      [existing.level, existing.series, existing.series]);
    await execute('UPDATE bom_structure_templates SET is_default = 1 WHERE id = ?', [params.id]);
  } else if (b.is_default === false) {
    await execute('UPDATE bom_structure_templates SET is_default = 0 WHERE id = ?', [params.id]);
  }

  const fields = [];
  const args = [];
  if (b.name != null) { fields.push('name = ?'); args.push(String(b.name).trim()); }
  if (b.series !== undefined) { fields.push('series = ?'); args.push(b.series?.trim() || null); }
  if (b.description !== undefined) { fields.push('description = ?'); args.push(b.description?.trim() || null); }
  if (Array.isArray(b.tree)) {
    const { nodeCount, itemCount, rootCount } = computeTemplateCounts(b.tree);
    fields.push('tree_json = ?', 'node_count = ?', 'item_count = ?', 'root_count = ?');
    args.push(JSON.stringify(b.tree), nodeCount, itemCount, rootCount);
  }
  if (fields.length) {
    args.push(params.id);
    await execute(`UPDATE bom_structure_templates SET ${fields.join(', ')} WHERE id = ?`, args);
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = await requireEngineeringAction(user, 'engineering.assembly.add');
  if (denied) return denied;
  await execute('DELETE FROM bom_structure_templates WHERE id = ?', [params.id]);
  return NextResponse.json({ ok: true });
}
