'use client';

// components/TraceabilityBadges.jsx — extracted from components/BomTable.jsx (gap-closure round,
// 2026-08-26). Engineering sets requires_heat_no/requires_mtc/requires_supplier_batch/
// requires_serial_no at Raise PR, but Procurement's actual working screens
// (ProcurementWorkspace.jsx, QcDocumentEditor.jsx) never rendered BomTable.jsx at all — the flag
// lived on the row but was structurally unreachable outside BomTable's own viewers (Engineering,
// Stores, Production). This is the single canonical badge renderer, used by BomTable.jsx,
// ProcurementWorkspace.jsx, and QcDocumentEditor.jsx — one implementation, three callers, so the
// badge logic can never drift between them.
//
// Red until the matching received_* field is filled (enforced server-side at the 'Received'
// transition, app/api/bom-items/[id]/route.js), green once it is — so the requirement and its
// fulfillment are both visible in one glance, not just the raw checkbox state. Renders nothing if
// the item has no requires_* flag set at all.
const FLAGS = [
  ['requires_heat_no', 'received_heat_no', 'Heat No.'],
  ['requires_mtc', 'received_mtc_no', 'MTC'],
  ['requires_supplier_batch', 'received_supplier_batch_no', 'Supplier Batch'],
  ['requires_serial_no', 'received_serial_no', 'Serial No.'],
];

export default function TraceabilityBadges({ item, className = 'mt-1 flex flex-wrap gap-1' }) {
  const active = FLAGS.filter(([flag]) => item?.[flag]);
  if (!active.length) return null;
  return (
    <div className={className}>
      {active.map(([flag, received, label]) => (
        <span key={flag}
          className={`rounded px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset ${
            item[received] ? 'bg-success/10 text-success ring-success/20' : 'bg-danger/10 text-danger ring-danger/20'}`}>
          {label}{item[received] ? ` ✓ ${item[received]}` : ' required'}
        </span>
      ))}
    </div>
  );
}
