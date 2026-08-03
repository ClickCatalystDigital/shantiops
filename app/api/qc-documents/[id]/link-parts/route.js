import { NextResponse } from 'next/server';
import { execute, queryAll, queryOne } from '@/lib/db';
import { getSessionUser, requireDepartment } from '@/lib/auth';
import { audit } from '@/lib/usb';

// Link one or more of this document's parts to a certificate — the single-row "Link…" action and
// the multi-select bulk action both call this (part_ids is always an array). The linked fields
// (chemistry/physical) are never sent here or stored on the part row — they're read live from the
// certificate at render time, which is what makes them display-only everywhere in the editor.
export async function POST(req, { params }) {
  const user = getSessionUser();
  const denied = requireDepartment(user, 'QC');
  if (denied) return denied;

  const document = await queryOne('SELECT id FROM qc_documents WHERE id = ?', [params.id]);
  if (!document) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const b = await req.json();
  const partIds = Array.isArray(b.part_ids) ? b.part_ids.filter(Boolean) : [];
  if (!partIds.length) return NextResponse.json({ error: 'No parts selected' }, { status: 400 });
  if (!b.test_certificate_id) return NextResponse.json({ error: 'test_certificate_id is required' }, { status: 400 });

  const cert = await queryOne('SELECT id FROM test_certificates WHERE id = ?', [b.test_certificate_id]);
  if (!cert) return NextResponse.json({ error: 'Certificate not found' }, { status: 404 });

  // Only touch rows that actually belong to this document — a stray/forged part_id from another
  // document must not be linkable through this endpoint.
  const own = await queryAll(
    `SELECT id FROM qc_document_parts WHERE document_id = ? AND id IN (${partIds.map(() => '?').join(',')})`,
    [params.id, ...partIds]);
  if (!own.length) return NextResponse.json({ error: 'Parts not found on this document' }, { status: 404 });
  const ownIds = own.map(r => r.id);

  await execute(
    `UPDATE qc_document_parts SET test_certificate_id = ? WHERE id IN (${ownIds.map(() => '?').join(',')})`,
    [cert.id, ...ownIds]);

  await audit('qc_document_link_parts', {
    actor: user.username,
    detail: JSON.stringify({ qc_document_id: Number(params.id), part_ids: ownIds, test_certificate_id: cert.id }),
  });
  return NextResponse.json({ ok: true, linked: ownIds.length });
}
