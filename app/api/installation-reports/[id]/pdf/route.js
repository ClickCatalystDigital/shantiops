import { NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import { getFreshSessionUser, canAccessDepartment, canAccessProject, isCustomer } from '@/lib/auth';
import { renderInstallationReportPdf } from '@/lib/installation-report-pdf';

export const runtime = 'nodejs';

export async function GET(req, { params }) {
  const user = await getFreshSessionUser();
  const { id } = await params;
  const row = await queryOne('SELECT r.*, p.project_no, p.company, p.master_project_id FROM installation_reports r JOIN projects p ON p.id = r.project_id WHERE r.id = ?', [id]);
  if (isCustomer(user)) {
    // A customer sees only a finalized report that was shared with them, on their own order (for a split
    // order the customer's project is the master, the report sits on a unit).
    const own = row && (canAccessProject(user, row.project_id) || (row.master_project_id && canAccessProject(user, row.master_project_id)));
    if (!row || !own || !row.customer_visible || !row.finalized_at) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  } else if (!user || !canAccessDepartment(user, 'Installation')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const pdf = await renderInstallationReportPdf({ ...row, data: JSON.parse(row.data_json || '{}') });
  return new NextResponse(pdf, { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${row.report_no}.pdf"` } });
}
