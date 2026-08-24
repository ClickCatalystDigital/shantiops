// lib/qc-bom-sync.js — auto-populate/sync a QC document's parts from its project's BOM.
// Used by every series, including SF — SF used to seed a fixed 54-row template transcribed from
// one real sample boiler (lib/qc-template.mjs), which baked that boiler's exact sizes/qty/part
// list into every other SF document regardless of its own BOM; switched to this shared sync so
// each document's parts actually reflect its own project.
//
// Which BOM lines qualify: `moc` (material of construction) is only ever set on real
// material lines (MS PLATE, MS ANGLE, BOILER TUBE...) — bought-out/mounting lines (pumps,
// gauges, valves) have no moc and don't get a mill test certificate, so they're excluded.
// Cancelled lines are dead and excluded too.
//
// Safe to call repeatedly: only inserts BOM lines not yet represented on the document
// (INSERT OR IGNORE against the unique index from scripts/migrate-qc-bom-sync.mjs /
// scripts/migrate-named-parts.mjs) — never touches or removes an existing part, even one a user
// has since edited or linked.
import { getProjectBom } from './data';

// Plate lines from the composer (components/PrWorkspace.jsx, lib/section-shapes.js) carry
// {length, width, thickness} in category_fields_json — remapped to Form IV A's size_t/size_w/
// size_l. Not reliably present (manual/imported BOM rows never set category_fields_json), so this
// is a best-effort enhancement, same defensive shape as lib/remnant-match.js's parseDims — null/
// malformed/non-plate falls through to the size_spec fallback untouched.
function plateDims(b) {
  if (b.category !== 'plate' || !b.category_fields_json) return null;
  let f;
  try { f = JSON.parse(b.category_fields_json); } catch { return null; }
  if (f.thickness == null && f.width == null && f.length == null) return null;
  return {
    size_t: f.thickness != null ? String(f.thickness) : null,
    size_w: f.width != null ? String(f.width) : null,
    size_l: f.length != null ? String(f.length) : null,
  };
}

// Design's optional named-part breakdown (bom_items.named_parts_json — components/PrWorkspace.jsx's
// NamedPartsEditor): one purchased line becomes several separately-named fabricated parts (e.g. a
// real Form IV A sample lists SHELL BELT-I/IIA/IIB sharing one purchased plate). The plain
// single-row fallback keeps `part_name = b.material_description`, exactly what this always wrote
// before named parts existed — load-bearing for the unique index this INSERT OR IGNORE relies on
// (document_id, bom_item_id, part_name): changing the fallback's part_name would silently stop
// deduping re-syncs of every document created before this feature shipped, inserting a fresh
// duplicate generic row each time instead of being ignored.
function namedPartRows(b) {
  if (b.named_parts_json) {
    try {
      const parsed = JSON.parse(b.named_parts_json)
        .map(p => ({ part_name: String(p?.name || '').trim(), qty: p?.qty }))
        .filter(p => p.part_name);
      if (parsed.length) return parsed.map(p => ({ part_name: p.part_name, qty: String(p.qty || 1) }));
    } catch { /* malformed — fall through to the plain single-row shape below */ }
  }
  return [{ part_name: b.material_description, qty: b.qty_text || '1' }];
}

export async function syncQcPartsFromBom(tx, documentId, projectId) {
  const { bom } = await getProjectBom(projectId);
  const qualifying = bom.filter(b => b.moc && String(b.moc).trim() && b.purchase_status !== 'Cancelled');
  if (!qualifying.length) { await reconcilePartsCertificates(tx, documentId); return 0; }

  const max = await tx.execute({
    sql: 'SELECT MAX(sort_order) AS n FROM qc_document_parts WHERE document_id = ?',
    args: [documentId],
  });
  let sortOrder = (max.rows[0]?.n ?? -1) + 1;
  let added = 0;

  for (const b of qualifying) {
    const dims = plateDims(b);
    for (const part of namedPartRows(b)) {
      const res = await tx.execute({
        sql: `INSERT OR IGNORE INTO qc_document_parts (document_id, part_no, part_name, size_t, size_w, size_l, qty, bom_item_id, sort_order)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [documentId, String(sortOrder + 1), part.part_name,
          dims?.size_t ?? null, dims?.size_w ?? null, dims ? dims.size_l : (b.size_spec || null),
          part.qty, b.id, sortOrder],
      });
      if (Number(res.rowsAffected) > 0) { sortOrder++; added++; }
    }
  }
  await reconcilePartsCertificates(tx, documentId);
  return added;
}

// Bought-out/mounting lines — the mirror image of syncQcPartsFromBom's filter: `moc` unset is
// exactly what marks a line as bought hardware rather than raw material (pumps, gauges, valves —
// see that function's own comment). Same additive, re-sync-safe shape: INSERT OR IGNORE against
// the partial unique index, manual rows (bom_item_id NULL) never touched.
export async function syncMountingsFromBom(tx, documentId, projectId) {
  const { bom } = await getProjectBom(projectId);
  const qualifying = bom.filter(b => !(b.moc && String(b.moc).trim()) && b.purchase_status !== 'Cancelled');
  if (!qualifying.length) return 0;

  const max = await tx.execute({
    sql: 'SELECT MAX(sort_order) AS n FROM qc_mountings WHERE document_id = ?',
    args: [documentId],
  });
  let sortOrder = (max.rows[0]?.n ?? -1) + 1;
  let added = 0;

  for (const b of qualifying) {
    const res = await tx.execute({
      sql: `INSERT OR IGNORE INTO qc_mountings (document_id, description, size, make, qty, bom_item_id, sort_order)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [documentId, b.material_description, b.size_spec || null, b.make || null,
        b.qty_text || '1', b.id, sortOrder],
    });
    if (Number(res.rowsAffected) > 0) { sortOrder++; added++; }
  }
  return added;
}

// Links a named-part row (part_name set, not the '' fallback) to the physical stock_pieces cut
// against the same bom_item_id/part_name by Production (components/WorkersPanel.jsx's CutDialog),
// and inherits that piece's certificate — real, physical-piece-sourced traceability instead of the
// spec-similarity guess lib/tc-match.js's suggestCertificates makes for an unlinked part. Re-run on
// every sync (not gated to "just inserted this call"), so a part synced before Production ever cut
// anything still gets linked once they do — QC re-clicking "Sync from BOM" is what re-triggers it.
//
// `stock_piece_id` is only ever a representative reference (which piece to show a code for) — never
// the source of truth. Every decision here is made from the *full* candidate set:
//   - zero candidates: nothing cut yet, leave unlinked.
//   - exactly one distinct non-null certificate among them: link (partial fulfillment — fewer
//     physical pieces cut so far than the part's own qty — still links confidently as long as
//     what's been cut agrees; how many of how many is computed at read time, not stored here).
//   - more than one distinct certificate: leave unlinked. A real cast mismatch across re-cuts must
//     never be silently guessed between.
// `WHERE test_certificate_id IS NULL` on the UPDATE guarantees this never overwrites a link a human
// already made (manually, or on an earlier reconcile pass) — see app/api/qc-documents/[id]/
// link-parts/route.js for the other half of that rule (manual link/unlink also clear/never-set
// stock_piece_id, so the two mechanisms never leave a stale or contradictory reference behind).
export async function reconcilePartsCertificates(tx, documentId) {
  // The plain single-row fallback shares part_name with its own bom_item's material_description
  // (see namedPartRows above) — excluded here via the join, since Production's CutDialog never
  // offers a Part picker (so never sets stock_pieces.part_name) for a line with no real breakdown,
  // making a match there coincidental at best, never a genuine reconciliation.
  const unlinked = await tx.execute({
    sql: `SELECT qdp.id, qdp.bom_item_id, qdp.part_name FROM qc_document_parts qdp
          JOIN bom_items bi ON bi.id = qdp.bom_item_id
          WHERE qdp.document_id = ? AND qdp.test_certificate_id IS NULL AND qdp.part_name != bi.material_description`,
    args: [documentId],
  });
  for (const row of unlinked.rows) {
    const candidates = await tx.execute({
      sql: 'SELECT id, test_certificate_id FROM stock_pieces WHERE bom_item_id = ? AND part_name = ? ORDER BY id DESC',
      args: [row.bom_item_id, row.part_name],
    });
    const pieces = candidates.rows;
    if (!pieces.length) continue;
    const certs = [...new Set(pieces.map(p => p.test_certificate_id).filter(Boolean))];
    if (certs.length !== 1) continue;
    await tx.execute({
      sql: 'UPDATE qc_document_parts SET stock_piece_id = ?, test_certificate_id = ? WHERE id = ? AND test_certificate_id IS NULL',
      args: [pieces[0].id, certs[0], row.id],
    });
  }
}
