import { NextResponse } from 'next/server';
import { execute, queryAll, queryOne } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { audit } from '@/lib/usb';

// Certificate linking for qc_mountings — the same "link one or more rows to a certificate" action
// app/api/qc-documents/[id]/link-parts/route.js already provides for Form IV A material, mirrored
// here for bought-out mountings. Deliberately simpler than that sibling: no TC-match approval-history
// scoring (lib/tc-match.js's suggestCertificates is a material-spec/steel-maker comparison built for
// raw pressure-part material, not meaningful for a bought-out valve/gauge) and no stock_piece_id
// (mountings are procured whole, never cut from stock_pieces).
export async function POST(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'QC');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'QC', 'qc.document.write');
  if (actionDenied) return actionDenied;

  const document = await queryOne('SELECT id, project_id FROM qc_documents WHERE id = ?', [params.id]);
  if (!document) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const b = await req.json();
  const mountingIds = Array.isArray(b.mounting_ids) ? b.mounting_ids.filter(Boolean) : [];
  if (!mountingIds.length) return NextResponse.json({ error: 'No items selected' }, { status: 400 });
  if (!b.test_certificate_id) return NextResponse.json({ error: 'test_certificate_id is required' }, { status: 400 });

  const cert = await queryOne('SELECT id FROM test_certificates WHERE id = ?', [b.test_certificate_id]);
  if (!cert) return NextResponse.json({ error: 'Certificate not found' }, { status: 404 });

  // Only touch rows that actually belong to this document — same trust-boundary reasoning as
  // link-parts' own ownership check.
  const own = await queryAll(
    `SELECT id, bom_item_id FROM qc_mountings WHERE document_id = ? AND id IN (${mountingIds.map(() => '?').join(',')})`,
    [params.id, ...mountingIds]);
  if (!own.length) return NextResponse.json({ error: 'Items not found on this document' }, { status: 404 });
  const ownIds = own.map(r => r.id);

  await execute(
    `UPDATE qc_mountings SET test_certificate_id = ? WHERE id IN (${ownIds.map(() => '?').join(',')})`,
    [cert.id, ...ownIds]);

  // Auto-associate: same convention link-parts already established — using a cert on this project's
  // document means the cert belongs to this project. Idempotent.
  await execute('INSERT OR IGNORE INTO certificate_projects (certificate_id, project_id) VALUES (?, ?)',
    [cert.id, document.project_id]);

  // Multi-unit split sibling fan-out (§5bj) — mirrors link-parts' own logic, matched on bom_item_id
  // only (mountings have no free-text `part_name` fallback to match on; a manually-added mounting
  // with no bom_item_id simply isn't eligible for the fan-out, same as link-parts' own precondition).
  let siblingsLinked = 0;
  const sourceRow = own[0];
  if (b.also_link_siblings && ownIds.length === 1 && sourceRow.bom_item_id) {
    const parent = await queryOne('SELECT master_project_id FROM projects WHERE id = ?', [document.project_id]);
    if (parent?.master_project_id) {
      const siblingRows = await queryAll(
        `SELECT qm.id, p.id AS sibling_project_id
           FROM qc_mountings qm
           JOIN qc_documents qd ON qd.id = qm.document_id
           JOIN projects p ON p.id = qd.project_id
          WHERE p.master_project_id = ? AND p.id != ? AND qm.bom_item_id = ?`,
        [parent.master_project_id, document.project_id, sourceRow.bom_item_id]);
      if (siblingRows.length) {
        const siblingIds = siblingRows.map(r => r.id);
        await execute(
          `UPDATE qc_mountings SET test_certificate_id = ? WHERE id IN (${siblingIds.map(() => '?').join(',')})`,
          [cert.id, ...siblingIds]);
        const siblingProjectIds = [...new Set(siblingRows.map(r => r.sibling_project_id))];
        for (const pid of siblingProjectIds) {
          await execute('INSERT OR IGNORE INTO certificate_projects (certificate_id, project_id) VALUES (?, ?)', [cert.id, pid]);
        }
        siblingsLinked = siblingIds.length;
      }
    }
  }

  await audit('qc_mounting_link_cert', {
    actor: user.username,
    detail: `certificate #${cert.id} -> ${ownIds.length} mounting(s) on document ${params.id}${siblingsLinked ? `, ${siblingsLinked} on sibling units` : ''}`,
  });
  return NextResponse.json({ ok: true, linked: ownIds.length, siblings_linked: siblingsLinked });
}

export async function DELETE(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'QC');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'QC', 'qc.document.write');
  if (actionDenied) return actionDenied;

  const document = await queryOne('SELECT id FROM qc_documents WHERE id = ?', [params.id]);
  if (!document) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const b = await req.json();
  const mountingIds = Array.isArray(b.mounting_ids) ? b.mounting_ids.filter(Boolean) : [];
  if (!mountingIds.length) return NextResponse.json({ error: 'No items selected' }, { status: 400 });

  const own = await queryAll(
    `SELECT id FROM qc_mountings WHERE document_id = ? AND id IN (${mountingIds.map(() => '?').join(',')})`,
    [params.id, ...mountingIds]);
  if (!own.length) return NextResponse.json({ error: 'Items not found on this document' }, { status: 404 });
  const ownIds = own.map(r => r.id);

  await execute(
    `UPDATE qc_mountings SET test_certificate_id = NULL WHERE id IN (${ownIds.map(() => '?').join(',')})`,
    ownIds);

  await audit('qc_mounting_unlink_cert', {
    actor: user.username,
    detail: JSON.stringify({ qc_document_id: Number(params.id), mounting_ids: ownIds }),
  });
  return NextResponse.json({ ok: true, unlinked: ownIds.length });
}
