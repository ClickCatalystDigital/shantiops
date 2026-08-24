// lib/qc-bom-sync.js — auto-populate/sync a QC document's parts from its project's BOM.
// Only for non-SF documents (SF keeps its fixed statutory template, lib/qc-template.mjs).
//
// Which BOM lines qualify: `moc` (material of construction) is only ever set on real
// material lines (MS PLATE, MS ANGLE, BOILER TUBE...) — bought-out/mounting lines (pumps,
// gauges, valves) have no moc and don't get a mill test certificate, so they're excluded.
// Cancelled lines are dead and excluded too.
//
// Safe to call repeatedly: only inserts BOM lines not yet represented on the document
// (INSERT OR IGNORE against the partial unique index from scripts/migrate-qc-bom-sync.mjs)
// — never touches or removes an existing part, even one a user has since edited or linked.
import { getProjectBom } from './data';

export async function syncQcPartsFromBom(tx, documentId, projectId) {
  const { bom } = await getProjectBom(projectId);
  const qualifying = bom.filter(b => b.moc && String(b.moc).trim() && b.purchase_status !== 'Cancelled');
  if (!qualifying.length) return 0;

  const max = await tx.execute({
    sql: 'SELECT MAX(sort_order) AS n FROM qc_document_parts WHERE document_id = ?',
    args: [documentId],
  });
  let sortOrder = (max.rows[0]?.n ?? -1) + 1;
  let added = 0;

  for (const b of qualifying) {
    const res = await tx.execute({
      sql: `INSERT OR IGNORE INTO qc_document_parts (document_id, part_no, part_name, size_l, qty, bom_item_id, sort_order)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [documentId, String(sortOrder + 1), b.material_description, b.size_spec || null,
        b.qty_text || '1', b.id, sortOrder],
    });
    if (Number(res.rowsAffected) > 0) { sortOrder++; added++; }
  }
  return added;
}
