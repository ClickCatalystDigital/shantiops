// app/api/projects/[id]/bom-tree/pdf/route.js — PDF export of the read-only Final BOM tree, same
// shape as app/api/projects/[id]/bom/pdf/route.js.
import { NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import { getFreshSessionUser, isInternal } from '@/lib/auth';
import { getBomStructure, getProjectBom } from '@/lib/data';
import { renderBomTreePdf } from '@/lib/bom-tree-pdf';

export const runtime = 'nodejs';

export async function GET(req, { params }) {
  const user = await getFreshSessionUser();
  if (!isInternal(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const project = await queryOne('SELECT project_no, customer_name FROM projects WHERE id = ?', [params.id]);
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

  const [assemblies, { bom }] = await Promise.all([
    getBomStructure(params.id),
    getProjectBom(params.id),
  ]);
  const unassignedItems = bom.filter((r) => !r.assembly_id);

  const stream = await renderBomTreePdf({ project, assemblies, unassignedItems });
  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${project.project_no}-Final-BOM.pdf"`,
    },
  });
}
