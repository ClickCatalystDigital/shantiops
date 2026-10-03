// The customer's "items pending dispatch" list (portal Pending Items stage). A customer gets it for
// their own order; any internal user can open it too (portal preview).
import { NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import { getFreshSessionUser, isCustomer, isInternal, canAccessProject } from '@/lib/auth';
import { getPendingToSend } from '@/lib/data';
import { renderPendingToSendPdf } from '@/lib/pending-to-send-pdf';

export const runtime = 'nodejs';

export async function GET(req, { params }) {
  const user = await getFreshSessionUser();
  if (isCustomer(user) ? !canAccessProject(user, params.id) : !isInternal(user)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const project = await queryOne('SELECT project_no, customer_name, company FROM projects WHERE id = ?', [params.id]);
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const { pending } = await getPendingToSend(params.id);
  if (!pending.length) return NextResponse.json({ error: 'Nothing pending' }, { status: 404 });
  const pdf = await renderPendingToSendPdf({ project, items: pending });
  return new NextResponse(pdf, {
    headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${project.project_no}-pending-items.pdf"` },
  });
}
