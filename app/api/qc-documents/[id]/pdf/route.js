import { NextResponse } from 'next/server';
import { getQcDocumentDetail } from '@/lib/data';
import { queryOne } from '@/lib/db';
import { getFreshSessionUser, requireDepartment, isCustomer, isInternal, canAccessProject } from '@/lib/auth';
import { renderQcFolderPdf } from '@/lib/qc-folder-pdf';
import { checkpointSummaryFromDetail } from '@/lib/qc-checkpoints.mjs';

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
    // Other teams: only a document already shared with the customer (the portal preview).
    if (denied && !(isInternal(user) && detail.document.customer_visible)) return denied;
  }

  // Every checkpoint that actually applies to this document's model, not just Form IV A's parts
  // (milestone-automation plan §C — a deliberate tightening of the old, narrower gate). "Form
  // exists" is never treated as "form complete": zero applicable checkpoints, or any one of them
  // incomplete (unlinked mountings, a blank required header field, 0 Form III A groups on a model
  // that requires one), refuses the same way an unlinked Form IV A part always did.
  // Derived from the SAME detail already fetched above, not a second, independently-timed query —
  // the gate must never observe a moment newer than what actually gets rendered below.
  const checkpoints = checkpointSummaryFromDetail(detail.document, detail.parts, detail.mountings, detail.groups);
  if (!checkpoints || !checkpoints.totalCount) {
    return NextResponse.json({ error: 'Nothing to check on this document yet' }, { status: 409 });
  }
  if (!checkpoints.allComplete) {
    return NextResponse.json(
      { error: `${checkpoints.totalCount - checkpoints.completeCount} statutory checkpoint(s) still need to be completed` },
      { status: 409 });
  }

  // LEFT JOIN customers for Form III's "Contact Number" field — projects.customer_id is nullable
  // (a project isn't always linked to a real CRM customer row), so this stays a plain left join
  // with an honest '—' fallback in the render rather than assuming every project has one.
  const project = await queryOne(
    `SELECT p.id, p.project_no, p.customer_name, p.series, p.model_capacity, c.phone AS customer_phone
     FROM projects p LEFT JOIN customers c ON c.id = p.customer_id WHERE p.id = ?`,
    [detail.document.project_id]);
  const pdf = await renderQcFolderPdf(detail.document, detail.parts, detail.mountings, project, detail.groups, detail.form4aGroups, detail.seams);
  return new NextResponse(pdf, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${detail.document.doc_id.replace(/\//g, '-')}.pdf"`,
    },
  });
}
