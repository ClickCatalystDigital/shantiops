// app/api/projects/[id]/costing-pdf/route.js — REPORT-ENGINE-PLAN.md §10 Phase 2. Same isInternal
// gate as the existing JSON route (app/api/projects/[id]/costing/route.js) — margin visibility
// isn't a Sales-only concern, matches the original endpoint's own access rule exactly.
import { NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import { getFreshSessionUser, isInternal } from '@/lib/auth';
import { getProjectCosting } from '@/lib/data';
import { renderProjectCostingPdf } from '@/lib/project-costing-pdf';

export const runtime = 'nodejs';

export async function GET(req, { params }) {
  const user = await getFreshSessionUser();
  if (!isInternal(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const project = await queryOne('SELECT project_no, customer_name, company FROM projects WHERE id = ?', [params.id]);
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  const costing = await getProjectCosting(params.id);

  const pdf = await renderProjectCostingPdf(project, costing, project.company);
  return new NextResponse(pdf, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="Costing-${project.project_no}.pdf"`,
    },
  });
}
