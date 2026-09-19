import { NextResponse } from 'next/server';
import { queryAll, queryOne } from '@/lib/db';
import { getFreshSessionUser } from '@/lib/auth';
import { requireEngineeringAction } from '@/lib/action-permissions';

// Read-only "where is this template used" for the Structure Templates manager: one row per node a
// template built (lineage is stamped on root nodes only), real projects only — the hidden
// template-sandbox project (is_system) holds throwaway nodes that aren't a BOM using the template.
// `version` is the template version that node was built from (NULL = applied before versioning).
export async function GET(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = await requireEngineeringAction(user, 'engineering.assembly.add');
  if (denied) return denied;
  const template = await queryOne('SELECT id, name, version FROM bom_structure_templates WHERE id = ?', [params.id]);
  if (!template) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const nodes = await queryAll(
    `SELECT a.id AS node_id, a.name AS node_name, a.structure_template_version AS version,
            p.id AS project_id, p.project_no, p.customer_name
       FROM bom_assemblies a JOIN projects p ON p.id = a.project_id
      WHERE a.structure_template_id = ? AND COALESCE(p.is_system, 0) = 0
      ORDER BY p.id DESC, a.id`, [params.id]);
  return NextResponse.json({ currentVersion: template.version, nodes });
}
