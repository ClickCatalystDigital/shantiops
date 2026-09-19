import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser } from '@/lib/auth';
import { requireEngineeringAction } from '@/lib/action-permissions';
import { computeTemplateCounts } from '@/lib/bom-structure.mjs';
import { audit } from '@/lib/usb';

// GET doubles as the sandbox-edit flow's "load what this template currently holds" — the JSON is
// parsed here once so no caller has to know it's stored as a string.
export async function GET(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = await requireEngineeringAction(user, 'engineering.assembly.add');
  if (denied) return denied;
  const row = await queryOne('SELECT * FROM bom_structure_templates WHERE id = ? AND archived_at IS NULL', [params.id]);
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
  const existing = await queryOne('SELECT id, level, series, tree_json FROM bom_structure_templates WHERE id = ? AND archived_at IS NULL', [params.id]);
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
    // Content version +1 only when the tree actually differs (see save-as-template's overwrite branch).
    if (existing.tree_json !== JSON.stringify(b.tree)) fields.push('version = version + 1');
  }
  if (fields.length) {
    args.push(params.id);
    await execute(`UPDATE bom_structure_templates SET ${fields.join(', ')} WHERE id = ?`, args);
  }
  return NextResponse.json({ ok: true });
}

// A template already stamped on BOM nodes (bom_assemblies.structure_template_id) is ARCHIVED, not
// deleted: hidden from every list/picker, row kept so those BOMs keep their lineage (and the FK, which
// Turso enforces, stays valid). An unused template is really deleted. The usage count decides (local
// SQLite dev doesn't enforce FKs); the try/catch is only the race fallback — if the template got applied
// between the count and the delete, archive instead of a raw FK 500.
// Archiving also renames: UNIQUE(level, series, name) would otherwise let a hidden row block re-creating
// a template with the same name, and nothing reads the name through the lineage link.
export async function DELETE(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = await requireEngineeringAction(user, 'engineering.assembly.add');
  if (denied) return denied;
  const row = await queryOne('SELECT id, name FROM bom_structure_templates WHERE id = ? AND archived_at IS NULL', [params.id]);
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Real projects only — a leaked template-sandbox node (is_system project) isn't "a BOM that used it";
  // if one still references the row, the hard delete hits the FK and the catch below archives instead.
  const used = await queryOne(
    `SELECT COUNT(*) AS n FROM bom_assemblies a JOIN projects p ON p.id = a.project_id
      WHERE a.structure_template_id = ? AND COALESCE(p.is_system, 0) = 0`, [row.id]);
  let archived = used.n > 0;
  if (!archived) {
    try {
      await execute('DELETE FROM bom_structure_templates WHERE id = ?', [row.id]);
    } catch (err) {
      if (!/FOREIGN KEY/i.test(String(err?.message))) throw err;
      archived = true;
    }
  }
  if (archived) {
    await execute(
      'UPDATE bom_structure_templates SET archived_at = CURRENT_TIMESTAMP, is_default = 0, name = ? WHERE id = ?',
      [`${row.name} [archived #${row.id}]`, row.id]);
  }
  await audit(archived ? 'bom_structure_template_archive' : 'bom_structure_template_delete',
    { actor: user.username, detail: `template ${row.id} ("${row.name}")` });
  return NextResponse.json({ ok: true, archived });
}
