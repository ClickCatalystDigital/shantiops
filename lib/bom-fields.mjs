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
  Production: ['issued_ref', 'received_ref'],
};

export const BOM_FIELDS = Object.values(BOM_FIELD_OWNERS).flat();

// Known purchase_status values (unknown imported values are kept as-is). CANCELLED is normally
// reached via the cancel-request flow (Design raises it, Procurement accepts — see
// app/api/production/tasks/accept-cancellations) but is still a plain selectable status here too,
// since Procurement already owns purchase_status outright and the request flow is a convenience,
// not a gate.
export const BOM_STATUSES = ['PENDING', 'TRANSIT', 'CLOSED', 'RECEIVED', 'CANCELLED'];

// PM → everything; a head → the union over their granted departments.
// Takes the session-user shape ({role, departments: []}); deliberately does not import
// lib/auth.js (which pulls next/headers and can't load client-side or in plain node).
export function editableBomFields(user) {
  if (user && ['admin', 'manager', 'executive'].includes(user.role)) return BOM_FIELDS;
  const depts = Array.isArray(user?.departments) ? user.departments : [];
  return [...new Set(depts.flatMap(d => BOM_FIELD_OWNERS[d] || []))];
}
