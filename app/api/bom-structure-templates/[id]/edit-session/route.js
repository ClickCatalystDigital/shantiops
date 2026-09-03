import { NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import { getFreshSessionUser } from '@/lib/auth';
import { requireEngineeringAction } from '@/lib/action-permissions';
import { insertTemplateTree } from '../../../bom-assemblies/[id]/apply-template/route';

// Sandbox-edit flow (the pencil icon in Structure Templates): materializes this template as a fresh
// root node under the existing sentinel "system" project (the same one §5e's stock/SAS bom_items
// already use — reused rather than seeding a second sentinel project for the same structural need:
// a real row to hang a throwaway node off of, invisible on every dashboard/rollup that filters
// status='active'). The client then opens the real BomStructureWorkspace on that node — a genuine,
// full-featured tree editor, no new nested-editing UI. "Update Template" (save-as-template with
// overwrite_template_id) and "Discard" (plain DELETE on the sandbox node) both reuse existing
// routes — this is the only new endpoint the whole sandbox flow needed.
export async function POST(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = await requireEngineeringAction(user, 'engineering.assembly.add');
  if (denied) return denied;

  const template = await queryOne('SELECT * FROM bom_structure_templates WHERE id = ?', [params.id]);
  if (!template) return NextResponse.json({ error: 'Template not found' }, { status: 404 });
  // A whole-BOM (multi-root) template can't safely go through the single-root sandbox flow yet:
  // insertTemplateTree only ever tracks the FIRST root it creates, so Update Template would silently
  // collapse the template down to just that one system (real data loss) and Discard would leak the
  // other roots as permanent orphaned garbage under the sentinel project. Server-side, not just a UI
  // disable — never trust the client alone on a path that can destroy real template content.
  if (template.root_count > 1) {
    return NextResponse.json({ error: 'Whole-BOM templates (multiple systems) can\'t be edited via the sandbox yet — re-save from a real project to update one.' }, { status: 400 });
  }
  const sentinel = await queryOne('SELECT id FROM projects WHERE is_system = 1 LIMIT 1');
  if (!sentinel) return NextResponse.json({ error: 'Sentinel project not found — check migrate() ran' }, { status: 500 });

  let tree = [];
  try { tree = JSON.parse(template.tree_json); } catch { /* corrupt data -> empty sandbox, not a crash */ }
  const result = await insertTemplateTree(tree, sentinel.id, null, template.id, user.username);

  return NextResponse.json({ projectId: sentinel.id, nodeId: result.rootId, templateName: template.name });
}
