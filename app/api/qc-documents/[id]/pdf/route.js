import { NextResponse } from 'next/server';
import { getQcDocumentDetail } from '@/lib/data';
import { getSessionUser, requireDepartment } from '@/lib/auth';
import { renderQcDocPdf } from '@/lib/qc-doc-pdf';

export const runtime = 'nodejs';

// The hard gate, enforced here — not just in the UI's disabled button. "It should fetch from the TC
// data only. Failing which it should not move forward" (QC-CHANGES.md §1) means the document cannot
// produce its PDF while any part is unlinked, and that has to hold even if this route is hit
// directly.
export async function GET(req, { params }) {
  const user = getSessionUser();
  const denied = requireDepartment(user, 'QC');
  if (denied) return denied;

  const detail = await getQcDocumentDetail(params.id);
  if (!detail) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const unlinked = detail.parts.filter(p => !p.test_certificate_id);
  if (unlinked.length) {
    return NextResponse.json(
      { error: `${unlinked.length} part${unlinked.length === 1 ? '' : 's'} still need${unlinked.length === 1 ? 's' : ''} a certificate` },
      { status: 409 });
  }

  const pdf = await renderQcDocPdf(detail.document, detail.parts);
  return new NextResponse(pdf, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${detail.document.doc_id.replace(/\//g, '-')}.pdf"`,
    },
  });
}
