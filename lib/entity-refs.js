// lib/entity-refs.js — resolves a typed/inserted code (e.g. "JC-1004", "BM-88") back to the row it
// names, for tagging entities inside incident/task free text (TicketsPanel.jsx's RaiseDialog).
// Generalizes findInventoryItemIdByCode's exact-match idiom (lib/data.js) to every entity that has,
// or can cheaply derive, a stable code — sits alongside that function, not a replacement for it.
//
// Two lookup shapes behind one registry, not a bug to unify: JC-/WO-/NCR-/DG-/CS-/PR-/RFQ-/FA-
// codes are stored WITH their prefix baked in (jc_no/wo_no/..., minted via nextNumber/
// nextCounterValue — lib/db.js), so those query the full matched token as-is, label = the code.
// BM- has no stored code at all (bom_items was never given a numbered identity) — BM-{id} is a
// reference token for this linking mechanism only, never a business-facing number. PO-/QT-/SO-/
// PK-/CN-/DN- are the same derived-id shape for a different reason: their real business numbers
// either contain slashes the token grammar can't represent (po_no "579/SB/2026-27", quotation_no
// "QTN-42/SB/2026-27", credit/debit note "SBE/CN/1/2026-27" — TOKEN_RE is hyphen-only, a `/` is a
// hard terminator), are heterogeneous free text with no reliable format (so_no, half-minted — see
// app/api/sale-orders/route.js), or collide with an existing prefix (packing_lists.packing_no is
// also "PL-####", already owned by stock pieces via resolveInventoryCode — PK- sidesteps it). For
// all six, label shows the REAL business number (queried by id), never the synthetic PO-{id} etc.
import { queryOne, queryAll } from './db';
import { findInventoryItemIdByCode } from './data';
import { findEntityRefTokens, ENTITY_TYPES } from './entity-ref-tokens';
import { canAccessDepartment, isPM } from './auth';

export { findEntityRefTokens, ENTITY_TYPES };

// Deep-link precision (continue-the-entity-ref-tagging plan, Part B) — appends the same code this
// ref resolved from as a `?highlight=` param, so the target page can scroll to + flash the exact
// row instead of just landing on the workspace. Every consumer of `href` already gets this for
// free since it's applied once here, not per-resolver.
function withHighlight(href, code) {
  if (!href) return href;
  return href.includes('?') ? `${href}&highlight=${code}` : `${href}?highlight=${code}`;
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
    // Job Cards render on /production/workers (WorkersPanel.jsx), not the project page — the
    // project page's DepartmentPanel never mounts JobCardBoard. `jobcards` opens the card's own
    // detail Sheet on load, per Part B's "click-to-open" highlight behavior.
    type: 'job_card', id: row.id, label: full, href: withHighlight('/production/workers?tab=jobcards', full), project_no: row.project_no,
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
    // Same page as Job Card (both live in WorkersPanel.jsx's WorkspaceSidebar), different tab.
    type: 'work_order', id: row.id, label: full, href: withHighlight('/production/workers?tab=workorders', full), project_no: row.project_no,
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
    // NCRs render on /qc's own NCR tab (QcWorkspace.jsx -> NcrPanel), cross-project — not the
    // project page. NcrPanel has no per-project filter to also set, so no project param here.
    type: 'ncr', id: row.id, label: full, href: withHighlight('/qc?tab=ncr', full), project_no: row.project_no,
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
    // Engineering owns the BOM item definitions (SYSTEM.md §5a) — ?dept= only steers a PM's tab
    // selection (a functional head's page is department-stacked regardless of the param).
    type: 'bom_item', id: row.id, label: full,
    href: row.project_id ? withHighlight(`/projects/${row.project_id}?dept=Engineering`, full) : null,
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
    type: 'drawing', id: row.id, label: full,
    href: row.project_id ? withHighlight(`/projects/${row.project_id}?dept=Design`, full) : null,
    project_no: row.project_no,
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

// Purchase Requisition — pr_no stored full ("PR-1"), same shape as jc_no/wo_no. Not project-scoped
// (a PR can span multiple projects via pr_item_projects) — no single /projects/{id} to point at.
async function resolvePr(full) {
  const row = await queryOne(
    `SELECT id, status, raised_by_dept, source FROM purchase_requisitions WHERE pr_no = ?`, [full]);
  if (!row) return null;
  return {
    type: 'purchase_requisition', id: row.id, label: full, href: '/pr',
    detail: { status: row.status, meta: [
      { label: 'Raised by', value: row.raised_by_dept || '—' },
      { label: 'Source', value: row.source || '—' },
    ] },
  };
}

// RFQ — rfq_no stored full ("RFQ-1"). No internal detail route exists (app/rfq/[token]/page.js is
// the external supplier portal, keyed by a different token, not this record) — surfaces inline in
// Procurement's Enquiry tab instead, same href:null treatment as GRN/inventory items.
async function resolveRfq(full) {
  const row = await queryOne(
    `SELECT id, status FROM rfqs WHERE rfq_no = ?`, [full]);
  if (!row) return null;
  return {
    type: 'rfq', id: row.id, label: full, href: null,
    detail: { status: row.status, meta: [] },
  };
}

// Fixed Asset — asset_no stored full ("FA-1001"). UNIQUE(company, asset_no) but minted from one
// global counter, so in practice it's unique app-wide — WHERE asset_no = ? resolves unambiguously.
async function resolveFixedAsset(full) {
  const row = await queryOne(
    `SELECT id, name, category, status, cost FROM fixed_assets WHERE asset_no = ?`, [full]);
  if (!row) return null;
  return {
    type: 'fixed_asset', id: row.id, label: full, href: withHighlight('/accounts?tab=fixed-assets', full),
    detail: { status: row.status, meta: [
      { label: 'Name', value: row.name },
      { label: 'Category', value: row.category || '—' },
      { label: 'Cost', value: row.cost != null ? `₹${row.cost}` : '—' },
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
    type: 'gir', id: row.id, label: full, href: withHighlight('/stores?tab=gir', full),
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
    type: 'gate_pass', id: row.id, label: full, href: withHighlight('/stores?tab=gatepasses', full),
    detail: { status: row.status, meta: [
      { label: 'Type', value: row.type === 'returnable' ? 'Returnable' : 'Non-returnable' },
      { label: 'Party', value: row.party || '—' },
    ] },
  };
}

// Purchase Order — po_no is "579/SB/2026-27" (no letter prefix, slash-delimited), which TOKEN_RE
// cannot represent. PO-{id} is a derived synthetic token, same idiom as BM-{id}; label shows the
// real po_no, never the synthetic code. No per-PO page — href lands on the Procurement workspace
// (PO list is a local-state tab there, not URL-addressable to the specific row).
async function resolvePo(full) {
  const id = idFrom(full);
  if (!id) return null;
  const row = await queryOne(
    `SELECT po.id, po.po_no, po.status, s.name AS supplier_name,
            (SELECT SUM(amount) FROM po_items WHERE po_id = po.id) AS total
       FROM purchase_orders po LEFT JOIN suppliers s ON s.id = po.supplier_id WHERE po.id = ?`, [id]);
  if (!row) return null;
  return {
    type: 'purchase_order', id: row.id, label: row.po_no, href: withHighlight('/procurement?tab=orders', full),
    detail: { status: row.status, meta: [
      { label: 'Supplier', value: row.supplier_name || '—' },
      { label: 'Total', value: row.total != null ? `₹${row.total}` : '—' },
    ] },
  };
}

// Quotation — quotation_no is "QTN-42/SB/2026-27" (slash-delimited past the QTN- prefix). Same
// derived-id treatment as PO. No per-quotation page — quotation_no itself links to its PDF
// (SalesWorkspace.jsx), not an internal record route; href lands on the Sales workspace.
async function resolveQuotation(full) {
  const id = idFrom(full);
  if (!id) return null;
  const row = await queryOne(
    `SELECT q.id, q.quotation_no, q.status, q.total, c.name AS customer_name
       FROM quotations q LEFT JOIN customers c ON c.id = q.customer_id WHERE q.id = ?`, [id]);
  if (!row) return null;
  return {
    type: 'quotation', id: row.id, label: row.quotation_no, href: withHighlight('/sales?tab=quotations', full),
    detail: { status: row.status, meta: [
      { label: 'Customer', value: row.customer_name || '—' },
      { label: 'Total', value: row.total != null ? `₹${row.total}` : '—' },
    ] },
  };
}

// Sale Order — so_no is heterogeneous: SO-{seq} on the quotation-convert path, arbitrary typed free
// text on the plain-create path (app/api/sale-orders/route.js — being fixed to also mint, same
// round). Derived-id sidesteps the format inconsistency entirely; label always shows the real
// so_no whatever shape it has.
async function resolveSaleOrder(full) {
  const id = idFrom(full);
  if (!id) return null;
  const row = await queryOne(
    `SELECT id, so_no, status, customer_name, total FROM sale_orders WHERE id = ?`, [id]);
  if (!row) return null;
  return {
    type: 'sale_order', id: row.id, label: row.so_no, href: withHighlight('/sales?tab=sale_orders', full),
    detail: { status: row.status, meta: [
      { label: 'Customer', value: row.customer_name || '—' },
      { label: 'Total', value: row.total != null ? `₹${row.total}` : '—' },
    ] },
  };
}

// Packing List — packing_no is "PL-1001", numerically the SAME shape as stock_pieces.code
// ("PL-0007", zero-padded from id) — REFS.PL already resolves to inventory. PK-{id} is a distinct
// synthetic prefix so the two never collide; label shows the real packing_no. The one derived-id
// entity here with a genuine own detail route.
async function resolvePackingList(full) {
  const id = idFrom(full);
  if (!id) return null;
  const row = await queryOne(
    `SELECT id, packing_no, status, customer_name, invoice_no FROM packing_lists WHERE id = ?`, [id]);
  if (!row) return null;
  return {
    type: 'packing_list', id: row.id, label: row.packing_no, href: `/packing/${row.id}`,
    detail: { status: row.status, meta: [
      { label: 'Customer', value: row.customer_name || '—' },
      { label: 'Invoice', value: row.invoice_no || '—' },
    ] },
  };
}

// Sales Invoice — invoice_no is "SB/13/2026-27" (company prefix + slashes), same non-hyphen-safe
// shape as po_no/quotation_no. Derived-id, same idiom as PO/QT. Added alongside the relations work
// (continue-the-entity-ref-tagging plan) — without this, PO/PK/QT/SO/CN's real FK relationships to
// an invoice had nothing to link to.
async function resolveSalesInvoice(full) {
  const id = idFrom(full);
  if (!id) return null;
  const row = await queryOne(
    `SELECT si.id, si.invoice_no, si.status, si.total, c.name AS customer_name
       FROM sales_invoices si LEFT JOIN customers c ON c.id = si.customer_id WHERE si.id = ?`, [id]);
  if (!row) return null;
  return {
    type: 'sales_invoice', id: row.id, label: row.invoice_no, href: withHighlight('/sales?tab=invoices', full),
    detail: { status: row.status, meta: [
      { label: 'Customer', value: row.customer_name || '—' },
      { label: 'Total', value: row.total != null ? `₹${row.total}` : '—' },
    ] },
  };
}

// Vendor Bill — bill_no is the SUPPLIER's own free-text number, not unique, not ours to key off.
// Derived-id, same idiom as PO. Added alongside the relations work for the same reason as SI above
// — PO's "Vendor Bills" relation and DN's "Against bill" relation both need somewhere to link.
async function resolveVendorBill(full) {
  const id = idFrom(full);
  if (!id) return null;
  const row = await queryOne(
    `SELECT vb.id, vb.bill_no, vb.status, vb.total, s.name AS supplier_name
       FROM vendor_bills vb LEFT JOIN purchase_orders po ON po.id = vb.po_id
       LEFT JOIN suppliers s ON s.id = po.supplier_id WHERE vb.id = ?`, [id]);
  if (!row) return null;
  return {
    type: 'vendor_bill', id: row.id, label: row.bill_no, href: withHighlight('/procurement?tab=vendor_bills', full),
    detail: { status: row.status, meta: [
      { label: 'Supplier', value: row.supplier_name || '—' },
      { label: 'Total', value: row.total != null ? `₹${row.total}` : '—' },
    ] },
  };
}

// Credit Note — credit_note_no is "SBE/CN/1/2026-27" (company invoice_prefix + slashes), no fixed
// literal prefix to key off. Derived-id, same as PO/QT.
async function resolveCreditNote(full) {
  const id = idFrom(full);
  if (!id) return null;
  const row = await queryOne(
    `SELECT cn.id, cn.credit_note_no, cn.status, cn.amount, si.invoice_no
       FROM sales_credit_notes cn LEFT JOIN sales_invoices si ON si.id = cn.sales_invoice_id WHERE cn.id = ?`, [id]);
  if (!row) return null;
  return {
    // Credit notes render inside the Invoices tab (SalesWorkspace.jsx), not their own tab.
    type: 'credit_note', id: row.id, label: row.credit_note_no, href: withHighlight('/sales?tab=invoices', full),
    detail: { status: row.status, meta: [
      { label: 'Against invoice', value: row.invoice_no || '—' },
      { label: 'Amount', value: row.amount != null ? `₹${row.amount}` : '—' },
    ] },
  };
}

// Debit Note — debit_note_no is "SBE/DN/1/2026-27", same shape as Credit Note. Derived-id.
async function resolveDebitNote(full) {
  const id = idFrom(full);
  if (!id) return null;
  const row = await queryOne(
    `SELECT dn.id, dn.debit_note_no, dn.status, dn.amount, vb.bill_no
       FROM purchase_debit_notes dn LEFT JOIN vendor_bills vb ON vb.id = dn.vendor_bill_id WHERE dn.id = ?`, [id]);
  if (!row) return null;
  return {
    // Debit notes render inside the Vendor Bills tab (ProcurementWorkspace.jsx), not their own tab.
    type: 'debit_note', id: row.id, label: row.debit_note_no, href: withHighlight('/procurement?tab=vendor_bills', full),
    detail: { status: row.status, meta: [
      { label: 'Against bill', value: row.bill_no || '—' },
      { label: 'Amount', value: row.amount != null ? `₹${row.amount}` : '—' },
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
  PR:  resolvePr,
  RFQ: resolveRfq,
  FA:  resolveFixedAsset,
  PL:  resolveInventoryCode,
  LN:  resolveInventoryCode,
  SR:  resolveInventoryCode,
  INV: resolveInventoryCode,
  INW: resolveGrn,
  GIR: resolveGir,
  GP:  resolveGatePass,
  PO:  resolvePo,
  QT:  resolveQuotation,
  SO:  resolveSaleOrder,
  PK:  resolvePackingList,
  CN:  resolveCreditNote,
  DN:  resolveDebitNote,
  SI:  resolveSalesInvoice,
  VB:  resolveVendorBill,
};

// Most entity types resolve for any internal user — verified during the original tagging round
// that reading project artifacts (JC/WO/NCR/BM/DG/CS/inventory/GRN/GIR/GP/SO) was never
// department-siloed anywhere else in this app (canAccessDepartment gates actions, not those
// reads). Procurement/Sales/Accounts/Dispatch's own *documents*, though, ARE read-gated at their
// normal page/route (app/procurement, app/sales, app/accounts, app/packing, and the matching API
// routes) — a Design/QC/Production user cannot open those workspaces at all. Tagging must not
// become a side door around that: these 8 prefixes mirror each entity's own existing gate exactly.
// Keyed by prefix (resolveEntityRef already has the prefix in hand before querying — cheap
// short-circuit, no wasted query for a department the user doesn't have).
const READ_GATE = {
  PR:  (user) => canAccessDepartment(user, 'Procurement'),
  RFQ: (user) => canAccessDepartment(user, 'Procurement'),
  PO:  (user) => canAccessDepartment(user, 'Procurement') || canAccessDepartment(user, 'Stores'),
  DN:  (user) => canAccessDepartment(user, 'Procurement'),
  QT:  (user) => isPM(user) || canAccessDepartment(user, 'Sales') || canAccessDepartment(user, 'Marketing'),
  CN:  (user) => isPM(user) || canAccessDepartment(user, 'Sales') || canAccessDepartment(user, 'Marketing'),
  FA:  (user) => canAccessDepartment(user, 'Accounts'),
  PK:  (user) => canAccessDepartment(user, 'Dispatch'),
  SI:  (user) => isPM(user) || canAccessDepartment(user, 'Sales') || canAccessDepartment(user, 'Marketing') || canAccessDepartment(user, 'Dispatch') || canAccessDepartment(user, 'Accounts'),
  VB:  (user) => canAccessDepartment(user, 'Procurement') || canAccessDepartment(user, 'Accounts'),
};

export async function resolveEntityRef(code, user) {
  // Normalized to uppercase here, once — every stored code (jc_no, wo_no, ...) is minted
  // uppercase, and the derived-id codes (BM-/GIR-/GP-/PO-/...) don't care about case beyond the
  // prefix. The *requested* code's original casing is preserved as the map key one level up
  // (resolveEntityRefs) so a lowercase-typed "jc-1004" in free text still matches back to itself
  // when LinkifiedText looks up `refs[part]`.
  const full = String(code).toUpperCase();
  const prefix = full.split('-')[0];
  const resolve = REFS[prefix];
  if (!resolve) return null;
  const gate = READ_GATE[prefix];
  // No department for this code the user doesn't have -> same degrade as an unknown/typo'd code,
  // never a 403 for one token in a batch of otherwise-fine ones.
  if (gate && !gate(user)) return null;
  try { return await resolve(full); } catch { return null; }
}

// Batched resolution for a whole list of tokens (one round trip, not one per token) — backs
// GET /api/entity-refs/resolve. Unresolvable/unknown/not-permitted codes are simply absent from
// the result map; callers render those as plain text, same degrade as a typo'd GitHub #issue ref.
export async function resolveEntityRefs(codes, user) {
  const unique = [...new Set(codes)];
  const results = await Promise.all(unique.map(async c => [c, await resolveEntityRef(c, user)]));
  const map = {};
  for (const [code, ref] of results) if (ref) map[code] = ref;
  return map;
}

// Same department gates as READ_GATE above, keyed by `type` (searchEntityRefs' own key) instead
// of prefix — this is what stops the "@" picker itself from being a browse-by-typing side door
// into Procurement/Sales/Accounts/Dispatch documents for a user who can't open those workspaces.
const SEARCH_GATE = {
  purchase_requisition: (user) => canAccessDepartment(user, 'Procurement'),
  rfq: (user) => canAccessDepartment(user, 'Procurement'),
  purchase_order: (user) => canAccessDepartment(user, 'Procurement') || canAccessDepartment(user, 'Stores'),
  debit_note: (user) => canAccessDepartment(user, 'Procurement'),
  quotation: (user) => isPM(user) || canAccessDepartment(user, 'Sales') || canAccessDepartment(user, 'Marketing'),
  credit_note: (user) => isPM(user) || canAccessDepartment(user, 'Sales') || canAccessDepartment(user, 'Marketing'),
  fixed_asset: (user) => canAccessDepartment(user, 'Accounts'),
  packing_list: (user) => canAccessDepartment(user, 'Dispatch'),
  sales_invoice: (user) => isPM(user) || canAccessDepartment(user, 'Sales') || canAccessDepartment(user, 'Marketing') || canAccessDepartment(user, 'Dispatch') || canAccessDepartment(user, 'Accounts'),
  vendor_bill: (user) => canAccessDepartment(user, 'Procurement') || canAccessDepartment(user, 'Accounts'),
};

// Search-by-type for MentionTextarea.jsx's "@" trigger — bounded, exact-ish (LIKE on the display text), each
// result carries enough of its own entity's existing display convention to disambiguate (matches
// JobCardBoard.jsx's `jc_no · section` treatment, etc.), plus project_no so identically-described
// rows on different projects don't look the same.
export async function searchEntityRefs(type, q, user) {
  const gate = SEARCH_GATE[type];
  if (gate && !gate(user)) return [];
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
    case 'purchase_requisition':
      return queryAll(
        `SELECT pr_no AS code, pr_no || ' · ' || COALESCE(raised_by_dept, source) AS label, NULL AS project_no
           FROM purchase_requisitions
          WHERE pr_no LIKE ? OR raised_by_dept LIKE ?
          ORDER BY id DESC LIMIT ${LIMIT}`, [needle, needle]);
    case 'rfq':
      return queryAll(
        `SELECT rfq_no AS code, rfq_no AS label, NULL AS project_no
           FROM rfqs WHERE rfq_no LIKE ? ORDER BY id DESC LIMIT ${LIMIT}`, [needle]);
    case 'purchase_order':
      return queryAll(
        `SELECT 'PO-' || po.id AS code, po.po_no || ' · ' || COALESCE(s.name, 'Unknown supplier') AS label, NULL AS project_no
           FROM purchase_orders po LEFT JOIN suppliers s ON s.id = po.supplier_id
          WHERE po.po_no LIKE ? OR s.name LIKE ?
          ORDER BY po.id DESC LIMIT ${LIMIT}`, [needle, needle]);
    case 'quotation':
      return queryAll(
        `SELECT 'QT-' || q.id AS code, q.quotation_no || ' · ' || COALESCE(c.name, 'Unknown customer') AS label, NULL AS project_no
           FROM quotations q LEFT JOIN customers c ON c.id = q.customer_id
          WHERE q.quotation_no LIKE ? OR c.name LIKE ?
          ORDER BY q.id DESC LIMIT ${LIMIT}`, [needle, needle]);
    case 'sale_order':
      return queryAll(
        `SELECT 'SO-' || id AS code, so_no || ' · ' || COALESCE(customer_name, 'Unknown customer') AS label, NULL AS project_no
           FROM sale_orders
          WHERE so_no LIKE ? OR customer_name LIKE ?
          ORDER BY id DESC LIMIT ${LIMIT}`, [needle, needle]);
    case 'packing_list':
      return queryAll(
        `SELECT 'PK-' || id AS code, packing_no || ' · ' || COALESCE(customer_name, 'Unknown customer') AS label, NULL AS project_no
           FROM packing_lists
          WHERE packing_no LIKE ? OR customer_name LIKE ?
          ORDER BY id DESC LIMIT ${LIMIT}`, [needle, needle]);
    case 'fixed_asset':
      return queryAll(
        `SELECT asset_no AS code, asset_no || ' · ' || name AS label, NULL AS project_no
           FROM fixed_assets
          WHERE asset_no LIKE ? OR name LIKE ?
          ORDER BY id DESC LIMIT ${LIMIT}`, [needle, needle]);
    case 'credit_note':
      return queryAll(
        `SELECT 'CN-' || id AS code, credit_note_no AS label, NULL AS project_no
           FROM sales_credit_notes WHERE credit_note_no LIKE ? ORDER BY id DESC LIMIT ${LIMIT}`, [needle]);
    case 'debit_note':
      return queryAll(
        `SELECT 'DN-' || id AS code, debit_note_no AS label, NULL AS project_no
           FROM purchase_debit_notes WHERE debit_note_no LIKE ? ORDER BY id DESC LIMIT ${LIMIT}`, [needle]);
    case 'sales_invoice':
      return queryAll(
        `SELECT 'SI-' || si.id AS code, si.invoice_no || ' · ' || COALESCE(c.name, 'Unknown customer') AS label, NULL AS project_no
           FROM sales_invoices si LEFT JOIN customers c ON c.id = si.customer_id
          WHERE si.invoice_no LIKE ? OR c.name LIKE ?
          ORDER BY si.id DESC LIMIT ${LIMIT}`, [needle, needle]);
    case 'vendor_bill':
      return queryAll(
        `SELECT 'VB-' || vb.id AS code, vb.bill_no || ' · ' || COALESCE(s.name, 'Unknown supplier') AS label, NULL AS project_no
           FROM vendor_bills vb LEFT JOIN purchase_orders po ON po.id = vb.po_id
           LEFT JOIN suppliers s ON s.id = po.supplier_id
          WHERE vb.bill_no LIKE ? OR s.name LIKE ?
          ORDER BY vb.id DESC LIMIT ${LIMIT}`, [needle, needle]);
    default:
      return [];
  }
}

// ================================================================================================
// Explicit relationships (continue-the-entity-ref-tagging plan, Part A) — turns a real FK column
// this app already had into a resolvable link, instead of a raw unlinked number
// (JobCardBoard.jsx used to print "BOM item #{id}") or nothing at all (NcrPanel.jsx never showed
// its own bom_item_id/work_order_id/job_card_id/stock_piece_id). One query per real relationship,
// matching this codebase's existing "small hand-written function per case" idiom rather than a
// generic FK-graph walker — the relation inventory here is exhaustive against the actual schema,
// not speculative.
//
// `raw` = the column already stores the full code (jc_no/wo_no/ncr_no/dg_no/pr_no/rfq_no/
// inward_batch_no/a stock_pieces.code) — used as-is. `derived(prefix)` = the column is a bare row
// id for a type that only ever gets a synthetic BM-/PO-/QT-/SO-/PK-/CN-/DN-/SI-/VB-/GIR-/GP-{id}
// code (see idFrom() above) — never confuse the two, a raw id run through `raw` would silently
// mismatch every derived-id type's actual stored code shape.
const raw = (v) => (v == null ? null : String(v));
const derived = (prefix) => (v) => (v == null ? null : `${prefix}-${v}`);

async function relOne(sql, args, codeFn) {
  const row = await queryOne(sql, args);
  if (!row) return [];
  const code = codeFn(Object.values(row)[0]);
  return code ? [{ code }] : [];
}
async function relMany(sql, args, codeFn) {
  const rows = await queryAll(sql, args);
  const codes = rows.map(r => codeFn(Object.values(r)[0])).filter(Boolean);
  return codes.map(code => ({ code }));
}

// Deliberately NOT modeled: CS (calc sheet — no cross-entity FK, only belongs to a project), FA
// (fixed asset — no FK to any of these types), GP (gate pass — no FK columns at all), PR/RFQ (no
// list page exists to link a relation *to* — the tooltip/label already carries what little there
// is), and `inventory_item`'s own outgoing relations — findInventoryItemIdByCode() (lib/data.js)
// deliberately collapses PL/LN/SR/INV all down to the shared inventory_items.id, discarding which
// specific stock_pieces row a PL-/LN- code named, so there is no way to ask "this resolved
// inventory_item's own receipt/job-card" without that specificity. The *reverse* direction (another
// entity's relation pointing AT a stock piece by its own code, e.g. NCR's "Stock piece" below) is
// unaffected — that only ever emits a fresh code for resolveEntityRefs to resolve normally.
const RELATIONS = {
  job_card: [
    { label: 'Material', fetch: id => relOne('SELECT bom_item_id AS v FROM job_cards WHERE id = ?', [id], derived('BM')) },
    { label: 'Work Order', fetch: id => relOne(
      `SELECT w.wo_no AS v FROM job_cards jc JOIN work_orders w ON w.id = jc.work_order_id WHERE jc.id = ?`, [id], raw) },
    { label: 'Rework of', fetch: id => relOne(
      `SELECT rwd.jc_no AS v FROM job_cards jc JOIN job_cards rwd ON rwd.id = jc.rework_of_job_card_id WHERE jc.id = ?`, [id], raw) },
    { label: 'Rework cards', fetch: id => relMany('SELECT jc_no AS v FROM job_cards WHERE rework_of_job_card_id = ?', [id], raw) },
    { label: 'Raised from NCR', fetch: id => relOne(
      `SELECT n.ncr_no AS v FROM job_cards jc JOIN ncr_records n ON n.id = jc.ncr_id WHERE jc.id = ?`, [id], raw) },
    { label: 'NCRs against this card', fetch: id => relMany('SELECT ncr_no AS v FROM ncr_records WHERE job_card_id = ?', [id], raw) },
  ],
  work_order: [
    { label: 'Sale Order', fetch: id => relOne('SELECT sale_order_id AS v FROM work_orders WHERE id = ?', [id], derived('SO')) },
    { label: 'NCRs', fetch: id => relMany('SELECT ncr_no AS v FROM ncr_records WHERE work_order_id = ?', [id], raw) },
  ],
  ncr: [
    { label: 'Material', fetch: id => relOne('SELECT bom_item_id AS v FROM ncr_records WHERE id = ?', [id], derived('BM')) },
    { label: 'Work Order', fetch: id => relOne(
      `SELECT w.wo_no AS v FROM ncr_records n JOIN work_orders w ON w.id = n.work_order_id WHERE n.id = ?`, [id], raw) },
    { label: 'Job Card', fetch: id => relOne(
      `SELECT jc.jc_no AS v FROM ncr_records n JOIN job_cards jc ON jc.id = n.job_card_id WHERE n.id = ?`, [id], raw) },
    { label: 'Stock piece', fetch: id => relOne(
      `SELECT sp.code AS v FROM ncr_records n JOIN stock_pieces sp ON sp.id = n.stock_piece_id WHERE n.id = ?`, [id], raw) },
    { label: 'Rework card created', fetch: id => relOne(
      `SELECT jc.jc_no AS v FROM ncr_records n JOIN job_cards jc ON jc.id = n.rework_job_card_id WHERE n.id = ?`, [id], raw) },
  ],
  bom_item: [
    { label: 'Drawing', fetch: id => relOne(
      `SELECT d.dg_no AS v FROM bom_items b JOIN calc_drawings d ON d.id = b.drawing_id WHERE b.id = ?`, [id], raw) },
    { label: 'Raised via PR', fetch: id => relOne(
      `SELECT pr.pr_no AS v FROM bom_items b JOIN pr_items pi ON pi.id = b.pr_item_id
         JOIN purchase_requisitions pr ON pr.id = pi.pr_id WHERE b.id = ?`, [id], raw) },
    { label: 'Purchase Orders', fetch: id => relMany(
      `SELECT DISTINCT po.id AS v FROM po_items poi JOIN purchase_orders po ON po.id = poi.po_id WHERE poi.bom_item_id = ?`, [id], derived('PO')) },
    { label: 'Packing Lists', fetch: id => relMany(
      `SELECT DISTINCT pl.id AS v FROM packing_items pit JOIN packing_lists pl ON pl.id = pit.packing_list_id WHERE pit.bom_item_id = ?`, [id], derived('PK')) },
    { label: 'Job Cards', fetch: id => relMany('SELECT jc_no AS v FROM job_cards WHERE bom_item_id = ?', [id], raw) },
    { label: 'NCRs', fetch: id => relMany('SELECT ncr_no AS v FROM ncr_records WHERE bom_item_id = ?', [id], raw) },
    { label: 'Work Orders', fetch: id => relMany(
      `SELECT DISTINCT wo.wo_no AS v FROM work_order_materials wom JOIN work_orders wo ON wo.id = wom.work_order_id WHERE wom.bom_item_id = ?`, [id], raw) },
    { label: 'RFQs', fetch: id => relMany(
      `SELECT DISTINCT r.rfq_no AS v FROM rfq_items ri JOIN rfqs r ON r.id = ri.rfq_id WHERE ri.bom_item_id = ?`, [id], raw) },
  ],
  drawing: [
    { label: 'Used by', fetch: id => relMany('SELECT id AS v FROM bom_items WHERE drawing_id = ?', [id], derived('BM')) },
  ],
  purchase_requisition: [
    { label: 'RFQs', fetch: id => relMany('SELECT rfq_no AS v FROM rfqs WHERE pr_id = ?', [id], raw) },
    { label: 'Materialized items', fetch: id => relMany(
      `SELECT DISTINCT b.id AS v FROM pr_items pi JOIN bom_items b ON b.pr_item_id = pi.id WHERE pi.pr_id = ?`, [id], derived('BM')) },
  ],
  rfq: [
    { label: 'Purchase Requisition', fetch: id => relOne(
      `SELECT pr.pr_no AS v FROM rfqs r JOIN purchase_requisitions pr ON pr.id = r.pr_id WHERE r.id = ?`, [id], raw) },
  ],
  purchase_order: [
    { label: 'Materials', fetch: id => relMany(
      `SELECT DISTINCT bom_item_id AS v FROM po_items WHERE po_id = ? AND bom_item_id IS NOT NULL`, [id], derived('BM')) },
    { label: 'Receipts (GRN)', fetch: id => relMany('SELECT inward_batch_no AS v FROM stock_receipts WHERE po_id = ?', [id], raw) },
    { label: 'Vendor Bills', fetch: id => relMany('SELECT id AS v FROM vendor_bills WHERE po_id = ?', [id], derived('VB')) },
  ],
  quotation: [
    { label: 'Sale Order', fetch: id => relOne('SELECT id AS v FROM sale_orders WHERE quotation_id = ?', [id], derived('SO')) },
  ],
  sale_order: [
    { label: 'Quotation', fetch: id => relOne('SELECT quotation_id AS v FROM sale_orders WHERE id = ?', [id], derived('QT')) },
    { label: 'Work Orders', fetch: id => relMany('SELECT wo_no AS v FROM work_orders WHERE sale_order_id = ?', [id], raw) },
    { label: 'Sales Invoices', fetch: id => relMany('SELECT id AS v FROM sales_invoices WHERE sale_order_id = ?', [id], derived('SI')) },
  ],
  packing_list: [
    { label: 'Sales Invoice', fetch: id => relOne('SELECT sales_invoice_id AS v FROM packing_lists WHERE id = ?', [id], derived('SI')) },
  ],
  sales_invoice: [
    { label: 'Sale Order', fetch: id => relOne('SELECT sale_order_id AS v FROM sales_invoices WHERE id = ?', [id], derived('SO')) },
    { label: 'Quotation', fetch: id => relOne('SELECT quotation_id AS v FROM sales_invoices WHERE id = ?', [id], derived('QT')) },
    { label: 'Credit Notes', fetch: id => relMany('SELECT id AS v FROM sales_credit_notes WHERE sales_invoice_id = ?', [id], derived('CN')) },
    { label: 'Packing Lists', fetch: id => relMany('SELECT id AS v FROM packing_lists WHERE sales_invoice_id = ?', [id], derived('PK')) },
  ],
  credit_note: [
    { label: 'Against invoice', fetch: id => relOne('SELECT sales_invoice_id AS v FROM sales_credit_notes WHERE id = ?', [id], derived('SI')) },
  ],
  vendor_bill: [
    { label: 'Purchase Order', fetch: id => relOne('SELECT po_id AS v FROM vendor_bills WHERE id = ?', [id], derived('PO')) },
    { label: 'Debit Notes', fetch: id => relMany('SELECT id AS v FROM purchase_debit_notes WHERE vendor_bill_id = ?', [id], derived('DN')) },
  ],
  debit_note: [
    { label: 'Against bill', fetch: id => relOne('SELECT vendor_bill_id AS v FROM purchase_debit_notes WHERE id = ?', [id], derived('VB')) },
  ],
  grn: [
    { label: 'Purchase Order', fetch: id => relOne('SELECT po_id AS v FROM stock_receipts WHERE id = ?', [id], derived('PO')) },
    // gate_inward_receipt_id stores gate_inward_receipts.id, but GIR's own code is keyed by the
    // separate gir_no column (idFrom() on a GIR- code matches gir_no, not id — see resolveGir) —
    // needs the join, a bare derived('GIR') on the raw FK id would silently mismatch.
    { label: 'Gate Inward Receipt', fetch: id => relOne(
      `SELECT g.gir_no AS v FROM stock_receipts r JOIN gate_inward_receipts g ON g.id = r.gate_inward_receipt_id WHERE r.id = ?`, [id], derived('GIR')) },
    { label: 'Stock pieces received', fetch: id => relMany('SELECT code AS v FROM stock_pieces WHERE receipt_id = ?', [id], raw) },
  ],
  gir: [
    { label: 'Receipt', fetch: id => relOne('SELECT inward_batch_no AS v FROM stock_receipts WHERE gate_inward_receipt_id = ?', [id], raw) },
  ],
};

// One relation hop deep, by design — every `fetch()` above emits fresh codes that flow through
// the same resolveEntityRefs() every other consumer uses, so department gating and
// unresolvable/typo'd-code degrade are free, and nothing here ever asks a resolved ref for ITS OWN
// relations (that would need a second round trip per hop and risks a cycle — BM -> JC -> BM -> ...).
export async function getRelatedEntities(type, id, user) {
  const specs = RELATIONS[type];
  if (!specs || !id) return [];
  const groups = await Promise.all(specs.map(async (spec) => {
    let codes;
    try { codes = await spec.fetch(id); } catch { codes = []; }
    if (!codes.length) return null;
    const refs = await resolveEntityRefs(codes.map(c => c.code), user);
    const items = codes.map(c => refs[c.code]).filter(Boolean);
    return items.length ? { label: spec.label, items } : null;
  }));
  return groups.filter(Boolean);
}
