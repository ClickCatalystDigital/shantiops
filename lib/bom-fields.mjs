// lib/bom-fields.mjs — BOM field ownership by department. Pure data + one pure function:
// safe to import from client components (no xlsx, no next/headers) and from node self-checks
// (.mjs so plain `node` can load it — the repo has no "type":"module").

// Which bom_items columns each department may edit. Mirrors the PMB spreadsheets' own column
// bands: "(by DESIGNS)" → Engineering, "PURCHASE DEPT." → Procurement, "STORES DEPT." → Stores,
// "PRODUCTION DEPT." → Production. Enforced server-side in the bom-items PATCH route.
export const BOM_FIELD_OWNERS = {
  Engineering: ['section', 'group_label', 'material_description', 'moc', 'size_spec', 'make', 'qty_text', 'remarks'],
  Procurement: ['purchase_status', 'pr_ref', 'po_ref'],
  Stores: ['grn_ref', 'grn_qty_text', 'pending_qty_text', 'bqtc_ref'],
  Production: ['issued_ref', 'received_ref', 'production_done'],
};

export const BOM_FIELDS = Object.values(BOM_FIELD_OWNERS).flat();

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

// Engineering's item definition — read-only context every BOM-viewing department needs regardless
// of who owns it (you can't source or receive an item without knowing what it is). Split out from
// BOM_FIELD_OWNERS.Engineering, which also carries section/group_label/material_description —
// already always visible (they're not in BomTable's optional COLUMNS) — and remarks, which stays
// out of the narrowed view below on purpose (mixed-ownership free text, not any one department's
// job to read).
export const BOM_CONTEXT_FIELDS = ['moc', 'size_spec', 'make', 'qty_text'];

// Departments that get a narrowed BOM table (their own columns + context only, not every other
// department's operational columns) instead of the full spreadsheet. Opt-in per department as each
// one's real needs get confirmed (§5c) — Procurement's is confirmed; Stores/Production aren't yet.
const SCOPED_BOM_VIEW = new Set(['Procurement']);

// `allColumns` is BomTable's own COLUMNS order — this just filters it down for a scoped department.
export function visibleBomColumns(department, allColumns) {
  if (!SCOPED_BOM_VIEW.has(department)) return allColumns;
  const own = BOM_FIELD_OWNERS[department] || [];
  return allColumns.filter(c => BOM_CONTEXT_FIELDS.includes(c) || own.includes(c));
}

// The Packing badge column is Dispatch's reconciliation signal — not useful to a scoped department.
export function showPackingColumn(department) {
  return !SCOPED_BOM_VIEW.has(department);
}
