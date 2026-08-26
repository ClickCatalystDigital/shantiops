import { NextResponse } from 'next/server';
import { getQcDocumentDetail } from '@/lib/data';
import { queryOne } from '@/lib/db';
import { getFreshSessionUser, requireDepartment, isCustomer, canAccessProject } from '@/lib/auth';
import { renderQcFolderPdf } from '@/lib/qc-folder-pdf';

export const runtime = 'nodejs';

// The hard gate, enforced here — not just in the UI's disabled button. "It should fetch from the TC
// data only. Failing which it should not move forward" (QC-CHANGES.md §1) means the document cannot
// produce its PDF while any part is unlinked, and that has to hold even if this route is hit
// directly.
export async function GET(req, { params }) {
  const user = await getFreshSessionUser();
  const detail = await getQcDocumentDetail(params.id);
  if (!detail) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // A customer may only view their own project's folder, and only once QC Head has shared it
  // (customer_visible — §6) — the completeness gate below still applies to everyone.
  if (isCustomer(user)) {
    if (!canAccessProject(user, detail.document.project_id) || !detail.document.customer_visible) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  } else {
    const denied = requireDepartment(user, 'QC');
    if (denied) return denied;
  }

  // A document with zero parts trivially has zero unlinked parts — "complete" has to mean
  // something was actually certified, not just that nothing is missing.
  if (!detail.parts.length) {
    return NextResponse.json({ error: 'This document has no parts yet' }, { status: 409 });
  }
  const unlinked = detail.parts.filter(p => !p.test_certificate_id);
  if (unlinked.length) {
    return NextResponse.json(
      { error: `${unlinked.length} part${unlinked.length === 1 ? '' : 's'} still need${unlinked.length === 1 ? 's' : ''} a certificate` },
      { status: 409 });
  }

  const project = await queryOne('SELECT id, project_no, customer_name, series FROM projects WHERE id = ?', [detail.document.project_id]);
  const pdf = await renderQcFolderPdf(detail.document, detail.parts, detail.mountings, project, detail.groups);
  return new NextResponse(pdf, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${detail.document.doc_id.replace(/\//g, '-')}.pdf"`,
    },
  });
}
