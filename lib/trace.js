// lib/trace.js — heat trace (docs/gulf-coast-asme-plan.md, Phase 1b). Forward from a heat or certificate:
// certificates → stock pieces (with cut lineage, receipt, supplier, PO) → BOM lines and projects → welds that
// join those lines → QC documents that cite the certificates. Backward from a project: every heat it used.
// Reads only; nothing here is stored.
import { queryAll } from './db';

const inList = a => a.map(() => '?').join(',') || 'NULL';
const norm = s => String(s || '').trim().toUpperCase();

async function certsFor({ heat, certId }) {
  if (certId) return queryAll('SELECT * FROM test_certificates WHERE id = ?', [certId]);
  return queryAll('SELECT * FROM test_certificates WHERE UPPER(TRIM(cast_no)) = ? OR UPPER(TRIM(heat_no)) = ? ORDER BY id', [norm(heat), norm(heat)]);
}

// One chain for a set of certificates sharing a heat (or one certificate).
async function chain(heat, certs) {
  const certIds = certs.map(c => c.id);
  // A mill prints a heat (melt) number and often a separate cast number; Stores may record either.
  const keys = [...new Set([heat, ...certs.flatMap(c => [c.heat_no, c.cast_no])].map(norm).filter(Boolean))];
  const pieces = await queryAll(`SELECT sp.id, sp.code, sp.kind, sp.status, sp.parent_id, sp.heat_no, sp.test_certificate_id, sp.weight_kg,
      sp.length_mm, sp.width_mm, sp.thickness_mm, sp.bom_item_id, sp.cut_at,
      COALESCE(op.project_no, p.project_no) AS project_no, COALESCE(sp.owner_project_id, sp.project_id) AS project_id,
      r.inward_batch_no, r.grn_ref, r.received_at, su.name AS supplier, po.po_no, ii.description AS item
    FROM stock_pieces sp
    LEFT JOIN projects op ON op.id = sp.owner_project_id LEFT JOIN projects p ON p.id = sp.project_id
    LEFT JOIN stock_receipts r ON r.id = sp.receipt_id LEFT JOIN suppliers su ON su.id = r.supplier_id
    LEFT JOIN purchase_orders po ON po.id = r.po_id LEFT JOIN inventory_items ii ON ii.id = sp.inventory_item_id
    WHERE sp.test_certificate_id IN (${inList(certIds)}) OR UPPER(TRIM(sp.heat_no)) IN (${inList(keys)})
    ORDER BY sp.id`, [...certIds, ...keys]);
  // A BOM line is on this heat when a piece of it was issued to the line, or Stores recorded the heat when receiving it.
  const received = keys.length ? await queryAll(`SELECT id FROM bom_items WHERE UPPER(TRIM(received_heat_no)) IN (${inList(keys)})`, keys) : [];
  const bomIds = [...new Set([...pieces.map(p => p.bom_item_id), ...received.map(r => r.id)].filter(Boolean))];
  const bom = bomIds.length ? await queryAll(`SELECT b.id, b.material_description, b.size_spec, b.moc, p.project_no, b.project_id
    FROM bom_items b JOIN projects p ON p.id = b.project_id WHERE b.id IN (${inList(bomIds)})`, bomIds) : [];
  const welds = bomIds.length ? await queryAll(`SELECT w.id, w.weld_no, w.joint, w.welder_stamps, w.nde, p.project_no, ps.wps_no
    FROM welds w JOIN projects p ON p.id = w.project_id LEFT JOIN wps ps ON ps.id = w.wps_id
    WHERE w.part_a_bom_item_id IN (${inList(bomIds)}) OR w.part_b_bom_item_id IN (${inList(bomIds)}) ORDER BY w.weld_no`, [...bomIds, ...bomIds]) : [];
  const documents = certIds.length ? await queryAll(`SELECT DISTINCT d.id, d.doc_id, d.series, p.project_no, dp.part_name
    FROM qc_document_parts dp JOIN qc_documents d ON d.id = dp.document_id JOIN projects p ON p.id = d.project_id
    WHERE dp.test_certificate_id IN (${inList(certIds)}) ORDER BY d.id`, certIds) : [];
  const linked = certIds.length ? await queryAll(`SELECT DISTINCT p.id, p.project_no, p.customer_name FROM certificate_projects cp
    JOIN projects p ON p.id = cp.project_id WHERE cp.certificate_id IN (${inList(certIds)})`, certIds) : [];
  const projects = new Map(linked.map(p => [p.project_no, p]));
  for (const x of [...pieces, ...bom, ...welds, ...documents]) if (x.project_no && !projects.has(x.project_no)) projects.set(x.project_no, { project_no: x.project_no });
  return { heat: heat || certs[0]?.heat_no || certs[0]?.cast_no || null, certificates: certs, pieces, bom, welds, documents, projects: [...projects.values()] };
}

export async function traceHeat(heat) {
  const certs = await certsFor({ heat });
  const c = await chain(heat, certs);
  return c.certificates.length || c.pieces.length ? [c] : [];
}

export async function traceCertificate(certId) {
  const certs = await certsFor({ certId });
  return certs.length ? [await chain(certs[0].heat_no || certs[0].cast_no, certs)] : [];
}

// Backward: every heat a project used (certificates linked to it, its pieces, and certificates in its QC documents).
export async function traceProject(projectId) {
  const rows = await queryAll(`
    SELECT COALESCE(t.heat_no, t.cast_no) AS heat FROM certificate_projects cp JOIN test_certificates t ON t.id = cp.certificate_id WHERE cp.project_id = ?
    UNION SELECT sp.heat_no FROM stock_pieces sp WHERE (sp.owner_project_id = ? OR sp.project_id = ?) AND sp.heat_no IS NOT NULL
    UNION SELECT COALESCE(t.heat_no, t.cast_no) FROM qc_document_parts dp JOIN qc_documents d ON d.id = dp.document_id
      JOIN test_certificates t ON t.id = dp.test_certificate_id WHERE d.project_id = ?`, [projectId, projectId, projectId, projectId]);
  const heats = [...new Set(rows.map(r => norm(r.heat)).filter(Boolean))].sort();
  const out = [];
  for (const h of heats) out.push(...await traceHeat(h));
  return out;
}
