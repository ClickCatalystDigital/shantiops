// lib/qc-bom-sync.js — auto-populate/sync a QC document's parts from its project's BOM.
// Used by every series, including SF — SF used to seed a fixed 54-row template transcribed from
// one real sample boiler (lib/qc-template.mjs), which baked that boiler's exact sizes/qty/part
// list into every other SF document regardless of its own BOM; switched to this shared sync so
// each document's parts actually reflect its own project.
//
// Which BOM lines qualify (real sample SB-1097 confirmed): a bought-out finished component
// (fusible plug, valve, gauge, controller — `category === 'standard'` in the BOM composer,
// lib/section-shapes.js) is a Mounting; a raw fabricated pressure part (`category` dimensional —
// lib/bom-fields.mjs's DIMENSIONAL_CATEGORIES — or `requires_mtc` set) is Form IV A/III A material.
// This used to key on `moc` presence alone, on the assumption bought-out lines never have one — but
// the composer actually *requires* an MOC whenever any category is set (PrWorkspace.jsx), including
// `standard` fitting lines (a valve body genuinely is CI/CS/SS/bronze), so that assumption was wrong
// and routed bought-out valves into Form IV A. `category`/`requires_mtc` reflect the department's own
// classification of the line and don't have that problem. Legacy/imported PMB rows that carry
// neither `category` nor `requires_mtc` (older data, never re-categorized) still fall back to the old
// moc-presence rule — `// ponytail:` known ceiling, upgrade path is backfilling `category` on those
// rows, not a smarter heuristic here. Cancelled lines are dead and excluded from both buckets.
import { getProjectBom } from './data';
import { DIMENSIONAL_CATEGORIES } from './bom-fields.mjs';

function classify(b) {
  if (b.category === 'standard') return 'mounting';
  if (DIMENSIONAL_CATEGORIES.includes(b.category) || b.requires_mtc) return 'material';
  if (!b.category && !b.requires_mtc) return b.moc && String(b.moc).trim() ? 'material' : 'mounting'; // legacy fallback
  return 'mounting';
}

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

// Which Form III A group (if any) a material line belongs to — matched by the group's own
// assembly_id first (Engineering's bom_assemblies tree), falling back to group_label (the PMB
// import's flat in-sheet heading) when no assembly match exists. Groups with neither key set never
// match anything (a group must be told what to pull). drawing_no is seeded once, from whichever
// matching line has one, using the released snapshot (drawing_revision_at_release) over the live/
// mutable drawing_revision — never overwritten once a group has its own value, since QC may have
// already edited it for a group spanning more than one drawing.
async function matchIiiaGroup(tx, documentId, b) {
  if (b.assembly_id == null && !b.group_label) return null;
  const groups = await tx.execute({ sql: 'SELECT * FROM qc_iiia_groups WHERE document_id = ?', args: [documentId] });
  const g = groups.rows.find(g => (b.assembly_id != null && g.assembly_id === b.assembly_id))
    || groups.rows.find(g => b.group_label && g.group_label === b.group_label);
  if (!g) return null;
  if (!g.drawing_no) {
    const dwg = b.drawing_revision_at_release || b.drawing_revision;
    if (dwg) await tx.execute({ sql: 'UPDATE qc_iiia_groups SET drawing_no = ? WHERE id = ?', args: [dwg, g.id] });
  }
  return g.id;
}

export async function syncQcPartsFromBom(tx, documentId, projectId) {
  const { bom } = await getProjectBom(projectId);
  const qualifying = bom.filter(b => classify(b) === 'material' && b.purchase_status !== 'Cancelled');
  if (!qualifying.length) { await reconcilePartsCertificates(tx, documentId); return 0; }

  const max = await tx.execute({
    sql: 'SELECT MAX(sort_order) AS n FROM qc_document_parts WHERE document_id = ?',
    args: [documentId],
  });
  let sortOrder = (max.rows[0]?.n ?? -1) + 1;
  let added = 0;

  for (const b of qualifying) {
    const dims = plateDims(b);
    const iiiaGroupId = await matchIiiaGroup(tx, documentId, b);
    for (const part of namedPartRows(b)) {
      const res = await tx.execute({
        sql: `INSERT OR IGNORE INTO qc_document_parts (document_id, part_no, part_name, size_t, size_w, size_l, qty, bom_item_id, sort_order, iiia_group_id)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [documentId, String(sortOrder + 1), part.part_name,
          dims?.size_t ?? null, dims?.size_w ?? null, dims ? dims.size_l : (b.size_spec || null),
          part.qty, b.id, sortOrder, iiiaGroupId],
      });
      if (Number(res.rowsAffected) > 0) { sortOrder++; added++; }
    }
  }
  await reconcilePartsCertificates(tx, documentId);
  return added;
}

// The canonical per-unit serial record (Inventory Identity & Traceability, already built —
// lib/inventory-serials.js) for a bought-out line, comma-joined across however many physical units
// were received against this bom_item_id (the sample's "3 valves -> 3 serial numbers" case).
// Prefers 'consumed' rows (Phase 3's material_issues/inventory_batch_allocations confirm these are
// what was actually installed) over merely 'reserved'/'available' ones. Falls back to the flat
// bom_items.received_serial_no (Stores' own single-value field) when no inventory_serials row exists
// yet — that table isn't wired into Stores' receiving UI for every item type yet, so most legacy
// lines still only have the flat field. `// ponytail:` that fallback is single-value only; real
// multi-unit coverage needs inventory_serials rows to exist, not a smarter fallback here.
async function mountingSerials(tx, bomItemId, fallback) {
  const rows = await tx.execute({
    sql: `SELECT serial_no, status FROM inventory_serials WHERE bom_item_id = ? AND serial_no IS NOT NULL AND serial_no != ''
          ORDER BY (status = 'consumed') DESC, id`,
    args: [bomItemId],
  });
  if (rows.rows.length) return rows.rows.map(r => r.serial_no).join(', ');
  return fallback || null;
}

// Bought-out/mounting lines — see this file's top comment for the classify() split. Same additive,
// re-sync-safe shape: INSERT OR IGNORE against the partial unique index, manual rows (bom_item_id
// NULL) never touched.
export async function syncMountingsFromBom(tx, documentId, projectId) {
  const { bom } = await getProjectBom(projectId);
  const qualifying = bom.filter(b => classify(b) === 'mounting' && b.purchase_status !== 'Cancelled');
  if (!qualifying.length) return 0;

  const max = await tx.execute({
    sql: 'SELECT MAX(sort_order) AS n FROM qc_mountings WHERE document_id = ?',
    args: [documentId],
  });
  let sortOrder = (max.rows[0]?.n ?? -1) + 1;
  let added = 0;

  for (const b of qualifying) {
    const serials = await mountingSerials(tx, b.id, b.received_serial_no);
    const res = await tx.execute({
      sql: `INSERT OR IGNORE INTO qc_mountings (document_id, description, size, moc, serial_numbers, make, qty, bom_item_id, sort_order)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [documentId, b.material_description, b.size_spec || null, b.moc || null, serials,
        b.make || null, b.qty_text || '1', b.id, sortOrder],
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
