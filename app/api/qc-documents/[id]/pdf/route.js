import { NextResponse } from 'next/server';
import { getQcDocumentDetail, getBomAssembliesFlat } from '@/lib/data';
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

  // LEFT JOIN customers for Form III's "Contact Number" field — projects.customer_id is nullable
  // (a project isn't always linked to a real CRM customer row), so this stays a plain left join
  // with an honest '—' fallback in the render rather than assuming every project has one.
  const project = await queryOne(
    `SELECT p.id, p.project_no, p.customer_name, p.series, c.phone AS customer_phone
     FROM projects p LEFT JOIN customers c ON c.id = p.customer_id WHERE p.id = ?`,
    [detail.document.project_id]);
  // Phase 3 — Form IV A's lettered sections read the tree that actually owns these bom_items rows,
  // not the document's own project — for a split child that's the MASTER's id (bi.project_id,
  // §5bj: a child document's parts always reference the master's bom_items). Falls back to the
  // document's own project when every part is manual/unlinked (bom_project_id null on all of them),
  // which just means getBomAssembliesFlat finds nothing and the render degrades to the flat table.
  const bomProjectId = detail.parts.find(p => p.bom_project_id != null)?.bom_project_id ?? detail.document.project_id;
  const assemblies = await getBomAssembliesFlat(bomProjectId);
  const pdf = await renderQcFolderPdf(detail.document, detail.parts, detail.mountings, project, detail.groups, assemblies, detail.seams);
  return new NextResponse(pdf, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${detail.document.doc_id.replace(/\//g, '-')}.pdf"`,
    },
  });
}
