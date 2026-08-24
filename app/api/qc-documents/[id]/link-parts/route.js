import { NextResponse } from 'next/server';
import { execute, queryAll, queryOne } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { audit } from '@/lib/usb';
import { normalizeMaterial } from '@/lib/remnant-match';

// Link one or more of this document's parts to a certificate — the single-row "Link…" action and
// the multi-select bulk action both call this (part_ids is always an array). The linked fields
// (chemistry/physical) are never sent here or stored on the part row — they're read live from the
// certificate at render time, which is what makes them display-only everywhere in the editor.
export async function POST(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'QC');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'QC', 'qc.document.write');
  if (actionDenied) return actionDenied;

  const document = await queryOne('SELECT id, project_id FROM qc_documents WHERE id = ?', [params.id]);
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

  // Auto-associate: using a cert on this project's document means the cert belongs to this project
  // (client-confirmed). Idempotent — the certificate_projects PK ignores a repeat.
  await execute('INSERT OR IGNORE INTO certificate_projects (certificate_id, project_id) VALUES (?, ?)',
    [cert.id, document.project_id]);

  // TC<->BOM-item suggestion approval history (see lib/tc-match.js) — single-row Link only. A bulk
  // multi-select action can apply one cert across parts with different bom_item_id links, so there's
  // no single "shown suggestion" to score honestly; scoring it anyway would let one click silently
  // approve/reject several unrelated keys at once.
  if (ownIds.length === 1 && Array.isArray(b.shown_candidates) && b.shown_candidates.length) {
    const certTC = await queryOne('SELECT material_spec, steel_maker FROM test_certificates WHERE id = ?', [cert.id]);
    const chosenSpec = normalizeMaterial(certTC?.material_spec);
    const chosenMaker = normalizeMaterial(certTC?.steel_maker);
    const now = new Date().toISOString();
    // Two suggested certs can normalize to the same (material_spec, steel_maker, inventory_item_id)
    // key (e.g. two casts from the same mill/spec) — dedupe so one link click can't double-count a
    // single key's approval/rejection, regardless of what the client happened to send.
    const seenKeys = new Set();
    for (const cand of b.shown_candidates) {
      if (!cand?.inventory_item_id || !cand?.material_spec) continue;
      const spec = normalizeMaterial(cand.material_spec);
      const maker = normalizeMaterial(cand.steel_maker);
      const dedupeKey = `${spec}|${maker}|${cand.inventory_item_id}`;
      if (seenKeys.has(dedupeKey)) continue;
      seenKeys.add(dedupeKey);
      const wasChosen = spec === chosenSpec && maker === chosenMaker;
      await execute(
        `INSERT INTO tc_item_match_approvals (material_spec, steel_maker, inventory_item_id, approval_count, rejection_count, last_approved_by, last_approved_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(material_spec, steel_maker, inventory_item_id) DO UPDATE SET
           approval_count = approval_count + excluded.approval_count,
           rejection_count = rejection_count + excluded.rejection_count,
           last_approved_by = CASE WHEN excluded.approval_count > 0 THEN excluded.last_approved_by ELSE last_approved_by END,
           last_approved_at = CASE WHEN excluded.approval_count > 0 THEN excluded.last_approved_at ELSE last_approved_at END`,
        [spec, maker, cand.inventory_item_id, wasChosen ? 1 : 0, wasChosen ? 0 : 1, user.username, now]);
    }
  }

  await audit('qc_document_link_parts', {
    actor: user.username,
    detail: JSON.stringify({ qc_document_id: Number(params.id), part_ids: ownIds, test_certificate_id: cert.id }),
  });
  return NextResponse.json({ ok: true, linked: ownIds.length });
}
