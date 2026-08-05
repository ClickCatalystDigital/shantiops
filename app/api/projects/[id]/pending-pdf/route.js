// aoo/api/projects/[id]/pending-pdf/route.js

import { NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import { getProjectBom } from '@/lib/data';
import { getSessionUser, requireDepartment } from '@/lib/auth';
import { renderPendingPdf } from '@/lib/packing-pdf';

export const runtime = 'nodejs';

export async function GET(req, { params }) {
  const denied = requireDepartment(getSessionUser(), 'Dispatch');
  if (denied) return denied;

  const project = await queryOne('SELECT * FROM projects WHERE id = ?', [params.id]);
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { pending } = await getProjectBom(params.id);
  if (!pending.length) return NextResponse.json({ error: 'No pending BOM lines' }, { status: 400 });

  const pdf = await renderPendingPdf(project, pending);
  return new NextResponse(pdf, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="pending-${project.project_no}.pdf"`,
    },
  });
}
