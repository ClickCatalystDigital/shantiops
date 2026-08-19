// app/api/projects/[id]/bom/pdf/route.js — same shape as scope-of-supply's PDF route.
import { NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import { getFreshSessionUser, isInternal } from '@/lib/auth';
import { getProjectBom } from '@/lib/data';
import { renderBomPdf } from '@/lib/bom-pdf';

export const runtime = 'nodejs';

export async function GET(req, { params }) {
  const user = await getFreshSessionUser();
  if (!isInternal(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const project = await queryOne('SELECT project_no, customer_name, bom_release_revision FROM projects WHERE id = ?', [params.id]);
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  const { bom } = await getProjectBom(params.id);

  const pdf = await renderBomPdf({ project, bom, revision: project.bom_release_revision || 0 });
  return new NextResponse(pdf, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="BOM-${project.project_no}.pdf"`,
    },
  });
}
