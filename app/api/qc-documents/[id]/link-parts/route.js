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
    `SELECT id, bom_item_id, part_name FROM qc_document_parts WHERE document_id = ? AND id IN (${partIds.map(() => '?').join(',')})`,
    [params.id, ...partIds]);
  if (!own.length) return NextResponse.json({ error: 'Parts not found on this document' }, { status: 404 });
  const ownIds = own.map(r => r.id);

  // Clears stock_piece_id alongside the cert — a manual spec-based pick isn't a claim about which
  // exact physical piece it came from (only lib/qc-bom-sync.js's reconcilePartsCertificates makes
  // that claim), so a stale "matched to piece …" reference must not survive a human overriding it.
  await execute(
    `UPDATE qc_document_parts SET test_certificate_id = ?, stock_piece_id = NULL WHERE id IN (${ownIds.map(() => '?').join(',')})`,
    [cert.id, ...ownIds]);

  // Auto-associate: using a cert on this project's document means the cert belongs to this project
  // (client-confirmed). Idempotent — the certificate_projects PK ignores a repeat.
  await execute('INSERT OR IGNORE INTO certificate_projects (certificate_id, project_id) VALUES (?, ?)',
    [cert.id, document.project_id]);

  // Multi-unit split — "bundle them together and attach TC": when this document's own project is a
  // split child, one certificate covering a real batch of material spread across many units should
  // link the same physically-identical part on every sibling child's own document in one action, not
  // one document at a time. Matched by bom_item_id when the source part has one — every sibling
  // document's parts were synced from the SAME master bom_items row (children never get their own
  // cloned BOM lines), so it's the exact same id on every sibling's part, a real FK match, not a
  // guess. Falls back to part_name only for a manually-added part with no bom_item_id (AddPartDialog
  // allows this). Only meaningful for a single-part link, same precondition the TC-match approval
  // scoring below already requires.
  let siblingsLinked = 0;
  const sourcePart = own[0];
  if (b.also_link_siblings && ownIds.length === 1 && (sourcePart.bom_item_id || sourcePart.part_name)) {
    const parent = await queryOne('SELECT master_project_id FROM projects WHERE id = ?', [document.project_id]);
    if (parent?.master_project_id) {
      const siblingParts = sourcePart.bom_item_id
        ? await queryAll(
            `SELECT qdp.id, p.id AS sibling_project_id
               FROM qc_document_parts qdp
               JOIN qc_documents qd ON qd.id = qdp.document_id
               JOIN projects p ON p.id = qd.project_id
              WHERE p.master_project_id = ? AND p.id != ? AND qdp.bom_item_id = ?`,
            [parent.master_project_id, document.project_id, sourcePart.bom_item_id])
        : await queryAll(
            `SELECT qdp.id, p.id AS sibling_project_id
               FROM qc_document_parts qdp
               JOIN qc_documents qd ON qd.id = qdp.document_id
               JOIN projects p ON p.id = qd.project_id
              WHERE p.master_project_id = ? AND p.id != ? AND qdp.bom_item_id IS NULL AND qdp.part_name = ?`,
            [parent.master_project_id, document.project_id, sourcePart.part_name]);
      if (siblingParts.length) {
        const siblingIds = siblingParts.map(r => r.id);
        await execute(
          `UPDATE qc_document_parts SET test_certificate_id = ?, stock_piece_id = NULL WHERE id IN (${siblingIds.map(() => '?').join(',')})`,
          [cert.id, ...siblingIds]);
        const siblingProjectIds = [...new Set(siblingParts.map(r => r.sibling_project_id))];
        for (const pid of siblingProjectIds) {
          await execute('INSERT OR IGNORE INTO certificate_projects (certificate_id, project_id) VALUES (?, ?)', [cert.id, pid]);
        }
        siblingsLinked = siblingIds.length;
      }
    }
  }

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
    detail: JSON.stringify({ qc_document_id: Number(params.id), part_ids: ownIds, test_certificate_id: cert.id, siblings_linked: siblingsLinked }),
  });
  return NextResponse.json({ ok: true, linked: ownIds.length, siblings_linked: siblingsLinked });
}

// Clear a part's certificate link without deleting the part — the trash-can button deletes the
// whole row (a real removal), this only reverts a part back to "unlinked" so it can be re-linked.
export async function DELETE(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'QC');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'QC', 'qc.document.write');
  if (actionDenied) return actionDenied;

  const document = await queryOne('SELECT id FROM qc_documents WHERE id = ?', [params.id]);
  if (!document) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const b = await req.json();
  const partIds = Array.isArray(b.part_ids) ? b.part_ids.filter(Boolean) : [];
  if (!partIds.length) return NextResponse.json({ error: 'No parts selected' }, { status: 400 });

  const own = await queryAll(
    `SELECT id FROM qc_document_parts WHERE document_id = ? AND id IN (${partIds.map(() => '?').join(',')})`,
    [params.id, ...partIds]);
  if (!own.length) return NextResponse.json({ error: 'Parts not found on this document' }, { status: 404 });
  const ownIds = own.map(r => r.id);

  // Clears stock_piece_id too — a following sync/reconcile pass is then free to re-link this row
  // from scratch instead of showing a stale "matched to piece …" reference the human just detached.
  await execute(
    `UPDATE qc_document_parts SET test_certificate_id = NULL, stock_piece_id = NULL WHERE id IN (${ownIds.map(() => '?').join(',')})`,
    ownIds);

  await audit('qc_document_unlink_parts', {
    actor: user.username,
    detail: JSON.stringify({ qc_document_id: Number(params.id), part_ids: ownIds }),
  });
  return NextResponse.json({ ok: true, unlinked: ownIds.length });
}
