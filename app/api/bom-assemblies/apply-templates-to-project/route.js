import { NextResponse } from 'next/server';
import { queryOne, queryAll } from '@/lib/db';
import { getFreshSessionUser } from '@/lib/auth';
import { requireEngineeringAction } from '@/lib/action-permissions';
import { audit } from '@/lib/usb';
import { insertTemplateTree } from '../[id]/apply-template/route';

// Project-scoped bootstrap variant — there's no parent node yet in the empty-tree case, so this
// can't live under a node id the way apply-template does. "Build from Templates" in the tree pane's
// empty state calls this with several template_ids at once, each landing as its own new top-level
// root. Reuses insertTemplateTree() (exported alongside apply-template's own POST) so the idMap
// insert logic exists in exactly one place regardless of which route calls it.
export async function POST(req) {
  const user = await getFreshSessionUser();
  const denied = await requireEngineeringAction(user, 'engineering.assembly.add');
  if (denied) return denied;

  const b = await req.json();
  const projectId = Number(b.project_id);
  const project = await queryOne('SELECT id FROM projects WHERE id = ?', [projectId]);
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  const templateIds = Array.isArray(b.template_ids) ? b.template_ids.map(Number).filter(Boolean) : [];
  if (!templateIds.length) return NextResponse.json({ error: 'template_ids is required' }, { status: 400 });

  const templates = await queryAll(
    `SELECT * FROM bom_structure_templates WHERE id IN (${templateIds.map(() => '?').join(',')})`, templateIds);

  let totalNodes = 0, totalItems = 0;
  const rootIds = [];
  for (const template of templates) {
    let tree = [];
    try { tree = JSON.parse(template.tree_json); } catch { /* corrupt data -> skip, not a crash */ }
    const result = await insertTemplateTree(tree, projectId, null, template.id, user.username);
    totalNodes += result.nodeCount;
    totalItems += result.itemCount;
    if (result.rootId != null) rootIds.push(result.rootId);
  }

  await audit('bom_assembly_apply_template', {
    actor: user.username,
    detail: `bootstrapped project ${projectId} from ${templates.length} template(s) — ${totalNodes} node(s), ${totalItems} item(s)`,
  });
  return NextResponse.json({ rootIds, nodeCount: totalNodes, itemCount: totalItems });
}
