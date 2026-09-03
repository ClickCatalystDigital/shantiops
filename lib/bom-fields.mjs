// lib/bom-fields.mjs — BOM field ownership by department. Pure data + one pure function:
// safe to import from client components (no xlsx, no next/headers) and from node self-checks
// (.mjs so plain `node` can load it — the repo has no "type":"module").

// Which bom_items columns each department may edit. Mirrors the PMB spreadsheets' own column
// bands: "(by DESIGNS)" → Engineering, "PURCHASE DEPT." → Procurement, "STORES DEPT." → Stores,
// "PRODUCTION DEPT." → Production. Enforced server-side in the bom-items PATCH route.
export const BOM_FIELD_OWNERS = {
  // requires_* (Inventory Identity & Traceability, Phase 1) — a drawing-driven judgment call about
  // this specific line on this specific project, so it lives with Engineering's other material-spec
  // fields, not on a catalog/material-master row (a plate can be pressure-critical on one project and
  // structural filler on another — see lib/db.js's addColumn comment for the four columns).
  Engineering: ['section', 'group_label', 'material_description', 'moc', 'size_spec', 'make', 'qty_text', 'remarks', 'assembly_id',
    'requires_heat_no', 'requires_mtc', 'requires_supplier_batch', 'requires_serial_no', 'requires_manufacturing'],
  Procurement: ['purchase_status', 'pr_ref', 'po_ref'],
  Stores: ['pending_qty_text', 'bqtc_ref'],
  Production: ['issued_ref', 'received_ref', 'production_done'],
};

// Canonical Stores Receiving (Feature A, 2026-09-02) — grn_ref/grn_qty_text/receipt_id/received_*
// used to be Stores-owned generic-PATCH fields, which is exactly how grn_ref ended up duplicated
// across bom_items/gate_inward_receipts/stock_receipts with no cross-check. They're removed from
// BOM_FIELD_OWNERS.Stores entirely — going forward these are writable only through the atomic
// POST /api/bom-items/[id]/receive action (lib/bom-receiving.js), which sets all of them together
// from one real stock_receipts row. Kept in BOM_FIELDS (below) so PM/admin/executive's existing
// full-access override on the generic PATCH route is unaffected — only Stores/Procurement lose the
// piecemeal path, not PM-tier's standing ability to correct anything directly.
export const RECEIVING_FIELDS = ['grn_ref', 'grn_qty_text', 'receipt_id', 'received_heat_no', 'received_mtc_no', 'received_supplier_batch_no', 'received_serial_no'];

export const BOM_FIELDS = [...Object.values(BOM_FIELD_OWNERS).flat(), ...RECEIVING_FIELDS];

// Every shape category the PR/BOM composer (components/PrWorkspace.jsx) can tag a line with that
// carries real geometry (CALC-CHANGES2.md §F) — the single source of truth shared by
// lib/remnant-match.js (which lines are candidates for stock-piece matching), lib/procurement.js
// (which lines are plain-stock matching's territory instead — dimensional ones are remnant-match's),
// and the purchase-requisitions API's category whitelist. Lives here, not in remnant-match.js or
// procurement.js themselves, so both can import it without a circular dependency (remnant-match.js
// already imports from procurement.js). `plate` is its own kind (matched by L/W/T); every other
// category is 'linear' (matched by length + a profile string) — see lib/remnant-match.js's parseDims.
export const DIMENSIONAL_CATEGORIES = ['plate', 'flat', 'round', 'square', 'octagonal', 'angle', 'beam', 'channel', 'tee'];

// Known purchase_status values (unknown imported values are kept as-is). Cancelled is normally
// reached via the cancel-request flow (Design raises it, Procurement accepts — see
// app/api/production/tasks/accept-cancellations) but is still a plain selectable status here too,
// since Procurement already owns purchase_status outright and the request flow is a convenience,
// not a gate.
//
// V2-CHANGES.md D4 (Group 5 Phase 5.0) — clean lifecycle, replacing the old PENDING/TRANSIT/
// CLOSED/RECEIVED/CANCELLED enum: Enquiry -> Comparison -> Ordered -> Transit -> Received |
// Cancelled | In-Stock. Open = still-moving procurement work; closed = resolved one way or
// another (In-Stock is D6's terminal "fulfilled from inventory, never procured" status, only
// reachable once Group 6 builds the fulfil-from-stock action). Single source of truth — every
// site that used to inline the old string arrays now imports from here (Phase 5.0 sweep).
export const PURCHASE_STATUSES = ['Enquiry', 'Comparison', 'Ordered', 'Transit', 'Received', 'Cancelled', 'In-Stock'];
export const DEFAULT_PURCHASE_STATUS = 'Enquiry';
export const OPEN_STATUSES = new Set(['Enquiry', 'Comparison', 'Ordered', 'Transit']);
export const CLOSED_STATUSES = new Set(['Received', 'Cancelled', 'In-Stock']);
// COALESCE-safe: a bom_item with no purchase_status set yet (or an unrecognized legacy value) is
// treated as Enquiry/open, matching DEFAULT_PURCHASE_STATUS and the old "blank counts as pending"
// convention.
export const isOpenStatus = s => !CLOSED_STATUSES.has(s);
export const isClosedStatus = s => CLOSED_STATUSES.has(s);

// Badge tone per status, shared by BomTable and the /procurement Status tab (both used to keep
// their own copy of this map).
export const STATUS_TONE = {
  Enquiry: 'bg-muted text-muted-foreground ring-border',
  Comparison: 'bg-muted text-muted-foreground ring-border',
  Ordered: 'bg-warning/10 text-warning ring-warning/20',
  Transit: 'bg-warning/10 text-warning ring-warning/20',
  Received: 'bg-success/10 text-success ring-success/20',
  Cancelled: 'bg-danger/10 text-danger ring-danger/20',
  'In-Stock': 'bg-success/10 text-success ring-success/20',
};

// Deprecated alias — kept so any straggler import doesn't hard-crash; new code should use
// PURCHASE_STATUSES directly.
export const BOM_STATUSES = PURCHASE_STATUSES;

// V2-CHANGES.md Phase 5.0b — Master BOM stage visualization (project-page Procurement queue +
// Operations Master BOM card). The bar itself only ever shows the 5 "still moving" stages, in
// pipeline order — Cancelled/In-Stock are terminal exits, not progress, so BomStageBar renders
// them as side counts instead of bar segments (a cancelled item isn't pipeline progress).
export const ACTIVE_STAGES = ['Enquiry', 'Comparison', 'Ordered', 'Transit', 'Received'];
export const EXIT_STAGES = ['Cancelled', 'In-Stock'];

// Solid fills for the stage bar — distinct from STATUS_TONE's badge ring/10%-tint classes above.
// Ordered gets its own blue (vs. Transit's amber) so the 5-segment bar reads as a clear left-to-
// right progression even though STATUS_TONE groups Ordered+Transit under one badge tone.
// Lighter than a solid fill — same restraint ProcurementFlow's TONE_CLASSES uses (faint wash,
// not a heavy block), just at a strength that still reads as "filled" inside bg-muted rather than
// a `-surface` wash disappearing into it.
export const STAGE_BAR_COLORS = {
  Enquiry: 'bg-muted-foreground/30',
  Comparison: 'bg-comparison/60',
  Ordered: 'bg-ordered/60',
  Transit: 'bg-warning/60',
  Received: 'bg-success/60',
};

// Pure bucketing shared by both stage-bar placements (and BomStageBar's own prop shape) — takes
// any array of BOM rows (bom_items or a subset) and returns counts for all 7 D4 values.
// Derive the operational stage from the stored status plus observable procurement signals. The
// database column is intentionally editable and is not updated by every quote/selection action,
// so every summary consumer must use this same function instead of reading purchase_status alone.
export function derivePurchaseStage(item) {
  const raw = item?.purchase_status;
  if (PURCHASE_STATUSES.includes(raw) && ['Ordered', 'Transit', 'Received', 'Cancelled', 'In-Stock'].includes(raw)) {
    return raw;
  }
  if (item?.selected_quote_id || item?.po_ref) return 'Ordered';
  if (Number(item?.quote_count) > 0) return 'Comparison';
  if (raw === 'Comparison') return 'Comparison';
  return DEFAULT_PURCHASE_STATUS;
}

export function bomStageCounts(items) {
  const counts = Object.fromEntries(PURCHASE_STATUSES.map(s => [s, 0]));
  for (const it of items) {
    counts[derivePurchaseStage(it)]++;
  }
  return counts;
}

// PM → everything; a head → the union over their granted departments.
// Takes the session-user shape ({role, departments: []}); deliberately does not import
// lib/auth.js (which pulls next/headers and can't load client-side or in plain node).
export function editableBomFields(user) {
  if (user && ['admin', 'manager', 'executive'].includes(user.role)) return BOM_FIELDS;
  const depts = Array.isArray(user?.departments) ? user.departments : [];
  return [...new Set(depts.flatMap(d => BOM_FIELD_OWNERS[d] || []))];
}

// Departments that get a narrowed BOM table — an EXPLICIT visible-column list, not derived from
// BOM_FIELD_OWNERS. Deliberately not "owned fields + a shared context list" (the pre-Engineering-
// round-3 shape): BOM_FIELD_OWNERS.Engineering includes `make`/`remarks` (fields Engineering may
// *edit* via the generic PATCH route), but the round-3 ask is specifically to hide those two as
// *columns* in this one scoped view — ownership (who may edit a field) and this view's visibility
// are two different questions, and deriving one from the other silently smuggled make/remarks back
// in via the old `own.includes(c)` OR-branch even when excluded from the context list. An explicit
// list per department sidesteps that entirely. Opt-in per department as each one's real needs get
// confirmed (§5c/round 3) — Procurement's and Engineering's are; Stores/Production aren't yet.
const VISIBLE_COLUMNS_BY_DEPT = {
  Procurement: ['moc', 'size_spec', 'make', 'qty_text', 'pr_ref', 'po_ref'],
  // Design resolves to this same list — no separate BOM_FIELD_OWNERS entry of its own (see above).
  // Keeps pr_ref (their own material's "PR No. & Date" origin, made real in round 3's Phase B) and
  // qty_text/moc/size_spec as read-only context; drops Make and every Procurement/Stores/
  // Production operational column named in the round-3 request (PO/GRN/GRN Qty/Pending Qty/BQ-TC/
  // Issued/Received/Prod. Done/Remarks).
  Engineering: ['moc', 'size_spec', 'qty_text', 'pr_ref'],
};

// `allColumns` is BomTable's own COLUMNS order — this just filters it down for a scoped department.
export function visibleBomColumns(department, allColumns) {
  const explicit = VISIBLE_COLUMNS_BY_DEPT[department];
  if (!explicit) return allColumns;
  return allColumns.filter(c => explicit.includes(c));
}

// The Packing badge column is Dispatch's reconciliation signal — not useful to Procurement's scoped
// view. Deliberately its own set, not reusing VISIBLE_COLUMNS_BY_DEPT's membership: Engineering's
// round-3 column list doesn't name Packing at all, so adding Engineering to the scoped-columns view
// above must not also silently hide something nobody asked to hide.
const HIDE_PACKING_FOR = new Set(['Procurement']);
export function showPackingColumn(department) {
  return !HIDE_PACKING_FOR.has(department);
}
