// lib/project-label.js — pure, dependency-free, safe to import from any client component. Extracted
// out of ProcurementWorkspace.jsx so PoDeliveryLotsWorkspace.jsx (which ProcurementWorkspace.jsx
// itself renders) can reuse it without a circular import between the two component files.

// V2-CHANGES.md Group 6 Phase 6.4 — source='stock'/'sas' items point at the sentinel system
// project (project_is_system, from getSourcingItems) instead of a real one; reads better here as
// "SO #.../Stock" than the sentinel's literal placeholder project_no.
export function projectLabel(it) {
  if (!it.project_is_system) return it.project_no;
  if (it.source === 'sas') return `SO #${it.sale_order_no || '—'}`;
  if (it.source === 'stock') return 'Stock';
  return it.project_no;
}
