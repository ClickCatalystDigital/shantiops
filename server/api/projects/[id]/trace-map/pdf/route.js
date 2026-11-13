// Material Trace Map PDF for one project (Data Book section 5).
import { NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import { getFreshSessionUser, canAccessDepartment } from '@/lib/auth';
import { traceProject } from '@/lib/trace';
import { renderTraceMapPdf } from '@/lib/trace-map-pdf';
import { forbidden, err } from '@/lib/quality-routes';

export async function GET(_req, props) {
  const params = await props.params;
  const user = await getFreshSessionUser();
  if (!canAccessDepartment(user, 'QC')) return forbidden();
  const project = await queryOne('SELECT id, project_no, customer_name, company FROM projects WHERE id = ?', [params.id]);
  if (!project) return err('Not found', 404);
  const buf = await renderTraceMapPdf({ project, chains: await traceProject(project.id), company: project.company, generatedBy: user.username });
  return new NextResponse(buf, { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="trace-map-${project.project_no}.pdf"` } });
}
