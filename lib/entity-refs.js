// lib/entity-refs.js — resolves a typed/inserted code (e.g. "JC-1004", "BM-88") back to the row it
// names, for tagging entities inside incident/task free text (TicketsPanel.jsx's RaiseDialog).
// Generalizes findInventoryItemIdByCode's exact-match idiom (lib/data.js) to every entity that has,
// or can cheaply derive, a stable code — sits alongside that function, not a replacement for it.
//
// Two lookup shapes behind one registry, not a bug to unify: JC-/WO-/NCR-/DG-/CS- codes are stored
// WITH their prefix baked in (jc_no/wo_no/ncr_no/dg_no/cs_no, minted via nextNumber — lib/db.js),
// so those query the full matched token as-is. BM- has no stored code at all — bom_items was never
// given a numbered identity — so BM-{id} is a reference token for this linking mechanism only,
// never a business-facing number. Drawings used to work the same way (DWG-{id}, label = name) until
// a later round reversed the 2026-08-19 "no numbered identity" decision and gave calc_drawings a
// real stored dg_no — DWG- is retired, DG- is now the canonical code (label = the code itself,
// same as JC-/WO-/NCR-), and it's also what QC's Form III A drawing_no links to
// (qc_iiia_groups.calc_drawing_id).
import { queryOne, queryAll } from './db';
import { findInventoryItemIdByCode } from './data';
import { findEntityRefTokens } from './entity-ref-tokens';

export { findEntityRefTokens };

function projectHref(projectId) {
  return projectId ? `/projects/${projectId}` : null;
}

// Used by every derived-id resolver (BM/DWG/GIR/GP — none of which legitimately have more than
// one hyphen). The token regex allows multiple hyphenated segments for stock-piece suffixes
// (PL-0007-U1), but that's a global grammar shared by every prefix — without this length check, a
// stray "BM-88-old" would still extract id 88, resolve successfully, and LinkifiedText would
// silently replace the whole "BM-88-old" substring with just "BM-88" on render, dropping "-old"
// with no indication anything changed. Requiring exactly two segments makes an over-long code fail
// to resolve instead — it renders as its own original, untouched text, same degrade as any other
// unresolved token.
function idFrom(full) {
  const parts = full.split('-');
  if (parts.length !== 2) return null;
  const n = Number(parts[1]);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// Every resolved ref carries a uniform `detail: { status, meta: [{label,value}] }` for the hover
// tooltip (LinkifiedText.jsx) — one generic tooltip renderer reads this shape, not five bespoke
// ones, same declarative-over-bespoke idiom MasterWorkTable.jsx's `columns.kind` already uses.

async function resolveJobCard(full) {
  const row = await queryOne(
    `SELECT jc.id, jc.project_id, jc.status, jc.section, jc.qty_planned, jc.qty_done, p.project_no
       FROM job_cards jc JOIN projects p ON p.id = jc.project_id WHERE jc.jc_no = ?`, [full]);
  if (!row) return null;
  return {
    type: 'job_card', id: row.id, label: full, href: projectHref(row.project_id), project_no: row.project_no,
    detail: { status: row.status, meta: [
      { label: 'Qty', value: `${row.qty_done ?? 0}/${row.qty_planned ?? 0}` },
      { label: 'Section', value: row.section },
    ] },
  };
}

async function resolveWorkOrder(full) {
  const row = await queryOne(
    `SELECT wo.id, wo.project_id, wo.status, wo.mode, wo.qty_planned, p.project_no
       FROM work_orders wo LEFT JOIN projects p ON p.id = wo.project_id WHERE wo.wo_no = ?`, [full]);
  if (!row) return null;
  return {
    type: 'work_order', id: row.id, label: full, href: projectHref(row.project_id), project_no: row.project_no,
    detail: { status: row.status, meta: [
      { label: 'Qty planned', value: row.qty_planned },
      { label: 'Mode', value: row.mode === 'against_stock' ? 'Against Stock' : 'Against Order' },
    ] },
  };
}

async function resolveNcr(full) {
  const row = await queryOne(
    `SELECT n.id, n.project_id, n.status, n.severity, n.disposition, p.project_no
       FROM ncr_records n LEFT JOIN projects p ON p.id = n.project_id WHERE n.ncr_no = ?`, [full]);
  if (!row) return null;
  return {
    type: 'ncr', id: row.id, label: full, href: projectHref(row.project_id), project_no: row.project_no,
    detail: { status: row.status, meta: [
      { label: 'Severity', value: row.severity || '—' },
      { label: 'Disposition', value: row.disposition || '—' },
    ] },
  };
}

async function resolveBomItem(full) {
  const id = idFrom(full);
  if (!id) return null;
  const row = await queryOne(
    `SELECT b.id, b.project_id, b.material_description, b.purchase_status, b.qty_text, p.project_no
       FROM bom_items b JOIN projects p ON p.id = b.project_id WHERE b.id = ?`, [id]);
  if (!row) return null;
  return {
    type: 'bom_item', id: row.id, label: full, href: projectHref(row.project_id),
    project_no: row.project_no,
    // Unrecognized/null purchase_status displays as Enquiry — same convention lib/bom-fields.mjs
    // uses everywhere else a raw purchase_status is shown. Material description moves into the
    // tooltip (meta) now that the link text is the code, not the description — the tooltip is the
    // only place that identifies *what* BM-{id} actually is.
    detail: { status: row.purchase_status || 'Enquiry', meta: [
      { label: 'Material', value: row.material_description },
      { label: 'Qty', value: row.qty_text || '—' },
    ] },
  };
}

async function resolveDrawing(full) {
  const row = await queryOne(
    `SELECT d.id, d.project_id, d.name, d.status, d.revision, d.customer_approved_at, p.project_no
       FROM calc_drawings d JOIN projects p ON p.id = d.project_id WHERE d.dg_no = ?`, [full]);
  if (!row) return null;
  return {
    type: 'drawing', id: row.id, label: full, href: projectHref(row.project_id), project_no: row.project_no,
    detail: { status: row.status, meta: [
      { label: 'Name', value: row.name },
      { label: 'Revision', value: row.revision || '—' },
      { label: 'Customer approved', value: row.customer_approved_at ? 'Yes' : 'No' },
    ] },
  };
}

async function resolveCalcSheet(full) {
  const row = await queryOne(
    `SELECT s.id, s.project_id, s.name, s.created_at, p.project_no
       FROM calc_sheets s JOIN projects p ON p.id = s.project_id WHERE s.cs_no = ?`, [full]);
  if (!row) return null;
  return {
    type: 'calc_sheet', id: row.id, label: full, href: `/calc/project/${row.project_id}/${row.id}`,
    project_no: row.project_no,
    detail: { status: null, meta: [
      { label: 'Name', value: row.name },
      { label: 'Created', value: row.created_at ? String(row.created_at).slice(0, 10) : '—' },
    ] },
  };
}

// GRN — this app calls it a "receipt" (stock_receipts.inward_batch_no, minted INW-#### via
// nextNumber, same full-code-stored shape as jc_no/wo_no/ncr_no). Not project-scoped (a receipt
// belongs to a supplier delivery, not one project) and has no standalone detail page yet — same
// href:null treatment as inventory items.
async function resolveGrn(full) {
  const row = await queryOne(
    `SELECT r.id, r.received_at, s.name AS supplier_name, po.po_no
       FROM stock_receipts r LEFT JOIN suppliers s ON s.id = r.supplier_id
       LEFT JOIN purchase_orders po ON po.id = r.po_id WHERE r.inward_batch_no = ?`, [full]);
  if (!row) return null;
  return {
    type: 'grn', id: row.id, label: full, href: null,
    detail: { meta: [
      { label: 'Supplier', value: row.supplier_name || '—' },
      { label: 'PO', value: row.po_no || '—' },
    ] },
  };
}

// GIR (Gate Inward Receipt) and Gate Pass — gir_no/gp_no are stored as bare integers, with "GIR-"/
// "GP-" applied only at display time (StoresWorkspace.jsx), same derived-prefix treatment BM-{id}
// uses for bom_items. Neither is project-scoped — both are Stores-wide gate/security logs — so
// href points at the Stores workspace tab that lists them, not a per-record page (none exists).
async function resolveGir(full) {
  const n = idFrom(full);
  if (!n) return null;
  const row = await queryOne(
    `SELECT id, gir_no, status, vehicle_no, supplier_name FROM gate_inward_receipts WHERE gir_no = ?`, [n]);
  if (!row) return null;
  return {
    type: 'gir', id: row.id, label: full, href: '/stores?tab=gir',
    detail: { status: row.status, meta: [
      { label: 'Vehicle', value: row.vehicle_no || '—' },
      { label: 'Supplier', value: row.supplier_name || '—' },
    ] },
  };
}

async function resolveGatePass(full) {
  const n = idFrom(full);
  if (!n) return null;
  const row = await queryOne(
    `SELECT id, gp_no, type, status, party FROM gate_passes WHERE gp_no = ?`, [n]);
  if (!row) return null;
  return {
    type: 'gate_pass', id: row.id, label: full, href: '/stores?tab=gatepasses',
    detail: { status: row.status, meta: [
      { label: 'Type', value: row.type === 'returnable' ? 'Returnable' : 'Non-returnable' },
      { label: 'Party', value: row.party || '—' },
    ] },
  };
}

async function resolveInventoryCode(full) {
  const inventoryItemId = await findInventoryItemIdByCode(full);
  if (!inventoryItemId) return null;
  const row = await queryOne(
    `SELECT i.id, it.item_code, it.description FROM inventory_items i JOIN items it ON it.id = i.item_id WHERE i.id = ?`,
    [inventoryItemId]);
  if (!row) return null;
  // Inventory items aren't project-scoped (they live in Stores, not on one project's BOM) — no
  // /projects/{id} to point at, so this is the one entity type that never renders as a link, and
  // the one type with no `detail` — the label is already the full description.
  return { type: 'inventory_item', id: row.id, label: row.description || row.item_code || full, href: null };
}

const REFS = {
  JC:  resolveJobCard,
  WO:  resolveWorkOrder,
  NCR: resolveNcr,
  BM:  resolveBomItem,
  DG:  resolveDrawing,
  CS:  resolveCalcSheet,
  PL:  resolveInventoryCode,
  LN:  resolveInventoryCode,
  SR:  resolveInventoryCode,
  INV: resolveInventoryCode,
  INW: resolveGrn,
  GIR: resolveGir,
  GP:  resolveGatePass,
};

export async function resolveEntityRef(code) {
  // Normalized to uppercase here, once — every stored code (jc_no, wo_no, ...) is minted
  // uppercase, and the derived-id codes (BM-/DWG-/GIR-/GP-) don't care about case beyond the
  // prefix. The *requested* code's original casing is preserved as the map key one level up
  // (resolveEntityRefs) so a lowercase-typed "jc-1004" in free text still matches back to itself
  // when LinkifiedText looks up `refs[part]`.
  const full = String(code).toUpperCase();
  const prefix = full.split('-')[0];
  const resolve = REFS[prefix];
  if (!resolve) return null;
  try { return await resolve(full); } catch { return null; }
}

// Batched resolution for a whole list of tokens (one round trip, not one per token) — backs
// GET /api/entity-refs/resolve. Unresolvable/unknown codes are simply absent from the result map;
// callers render those as plain text, same degrade as a typo'd GitHub #issue reference.
export async function resolveEntityRefs(codes) {
  const unique = [...new Set(codes)];
  const results = await Promise.all(unique.map(async c => [c, await resolveEntityRef(c)]));
  const map = {};
  for (const [code, ref] of results) if (ref) map[code] = ref;
  return map;
}

export const ENTITY_TYPES = [
  { type: 'job_card', label: 'Job Card' },
  { type: 'work_order', label: 'Work Order' },
  { type: 'bom_item', label: 'Material' },
  { type: 'drawing', label: 'Drawing' },
  { type: 'calc_sheet', label: 'Calc Sheet' },
  { type: 'ncr', label: 'NCR' },
  { type: 'grn', label: 'GRN' },
  { type: 'gir', label: 'Gate Inward (GIR)' },
  { type: 'gate_pass', label: 'Gate Pass' },
];

// Search-by-type for MentionTextarea.jsx's "@" trigger — bounded, exact-ish (LIKE on the display text), each
// result carries enough of its own entity's existing display convention to disambiguate (matches
// JobCardBoard.jsx's `jc_no · section` treatment, etc.), plus project_no so identically-described
// rows on different projects don't look the same.
export async function searchEntityRefs(type, q) {
  const needle = `%${String(q || '').trim()}%`;
  const LIMIT = 20;
  switch (type) {
    case 'job_card':
      return queryAll(
        `SELECT jc.jc_no AS code, jc.jc_no || ' · ' || jc.section AS label, p.project_no
           FROM job_cards jc JOIN projects p ON p.id = jc.project_id
          WHERE jc.jc_no IS NOT NULL AND (jc.jc_no LIKE ? OR jc.section LIKE ? OR p.project_no LIKE ?)
          ORDER BY jc.id DESC LIMIT ${LIMIT}`, [needle, needle, needle]);
    case 'work_order':
      return queryAll(
        `SELECT wo.wo_no AS code, wo.wo_no || ' · ' || wo.product_description AS label, p.project_no
           FROM work_orders wo LEFT JOIN projects p ON p.id = wo.project_id
          WHERE wo.wo_no LIKE ? OR wo.product_description LIKE ? OR p.project_no LIKE ?
          ORDER BY wo.id DESC LIMIT ${LIMIT}`, [needle, needle, needle]);
    case 'ncr':
      return queryAll(
        `SELECT n.ncr_no AS code, n.ncr_no AS label, p.project_no
           FROM ncr_records n LEFT JOIN projects p ON p.id = n.project_id
          WHERE n.ncr_no LIKE ? OR p.project_no LIKE ?
          ORDER BY n.id DESC LIMIT ${LIMIT}`, [needle, needle]);
    case 'bom_item':
      return queryAll(
        `SELECT 'BM-' || b.id AS code, b.material_description AS label, p.project_no
           FROM bom_items b JOIN projects p ON p.id = b.project_id
          WHERE b.material_description LIKE ? OR p.project_no LIKE ?
          ORDER BY b.id DESC LIMIT ${LIMIT}`, [needle, needle]);
    case 'drawing':
      return queryAll(
        `SELECT d.dg_no AS code, d.dg_no || ' · ' || d.name AS label, p.project_no
           FROM calc_drawings d JOIN projects p ON p.id = d.project_id
          WHERE d.dg_no IS NOT NULL AND (d.name LIKE ? OR d.dg_no LIKE ? OR p.project_no LIKE ?)
          ORDER BY d.id DESC LIMIT ${LIMIT}`, [needle, needle, needle]);
    case 'calc_sheet':
      return queryAll(
        `SELECT s.cs_no AS code, s.cs_no || ' · ' || s.name AS label, p.project_no
           FROM calc_sheets s JOIN projects p ON p.id = s.project_id
          WHERE s.cs_no IS NOT NULL AND (s.name LIKE ? OR s.cs_no LIKE ? OR p.project_no LIKE ?)
          ORDER BY s.id DESC LIMIT ${LIMIT}`, [needle, needle, needle]);
    case 'grn':
      return queryAll(
        `SELECT r.inward_batch_no AS code, r.inward_batch_no || ' · ' || COALESCE(s.name, 'Unknown supplier') AS label, NULL AS project_no
           FROM stock_receipts r LEFT JOIN suppliers s ON s.id = r.supplier_id
          WHERE r.inward_batch_no LIKE ? OR s.name LIKE ?
          ORDER BY r.id DESC LIMIT ${LIMIT}`, [needle, needle]);
    case 'gir':
      return queryAll(
        `SELECT 'GIR-' || gir_no AS code, 'GIR-' || gir_no || ' · ' || COALESCE(vehicle_no, supplier_name, 'Unknown') AS label, NULL AS project_no
           FROM gate_inward_receipts
          WHERE CAST(gir_no AS TEXT) LIKE ? OR vehicle_no LIKE ? OR supplier_name LIKE ?
          ORDER BY id DESC LIMIT ${LIMIT}`, [needle, needle, needle]);
    case 'gate_pass':
      return queryAll(
        `SELECT 'GP-' || gp_no AS code, 'GP-' || gp_no || ' · ' || COALESCE(party, type) AS label, NULL AS project_no
           FROM gate_passes
          WHERE CAST(gp_no AS TEXT) LIKE ? OR party LIKE ?
          ORDER BY id DESC LIMIT ${LIMIT}`, [needle, needle]);
    default:
      return [];
  }
}
