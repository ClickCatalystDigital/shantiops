'use client';

// components/bom-structure/NodeHistoryTab.jsx — read-only ECN history for every item under this
// node (including nested descendants), reusing the existing engineering-change-notes list/table
// exactly as-is via the new ?assembly_id= filter — no second change-control system.
import { useEffect, useState } from 'react';
import { api, showToast } from '@/lib/client';
import { HistoryIcon } from 'lucide-react';

const STATUS_CLS = {
  pending: 'bg-warning/10 text-warning ring-warning/20',
  approved: 'bg-success/10 text-success ring-success/20',
  rejected: 'bg-danger/10 text-danger ring-danger/20',
};
const STATUS_BORDER = {
  pending: 'border-l-warning', approved: 'border-l-success', rejected: 'border-l-danger',
};

export default function NodeHistoryTab({ node }) {
  const [notes, setNotes] = useState(null);

  useEffect(() => {
    api(`/api/engineering-change-notes?assembly_id=${node.id}`).then(setNotes).catch(err => showToast(err.message, 'error'));
  }, [node.id]);

  if (notes === null) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (notes.length === 0) return (
    <div className="flex flex-col items-center gap-1.5 rounded-md border border-dashed py-8 text-center">
      <HistoryIcon className="size-5 text-muted-foreground/60" />
      <p className="text-sm text-muted-foreground">No engineering change notes for this node yet.</p>
    </div>
  );

  return (
    <div className="flex flex-col divide-y rounded-md border">
      {notes.map(n => (
        <div key={n.id} className={`flex flex-col gap-1 border-l-2 px-3 py-2.5 text-sm transition-colors hover:bg-muted/40 ${STATUS_BORDER[n.status] || ''}`}>
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium">{n.material_description || n.field_changed}</span>
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STATUS_CLS[n.status] || ''}`}>{n.status}</span>
          </div>
          <span className="text-xs text-muted-foreground">{n.field_changed}: {n.old_value || '—'} → {n.new_value || '—'}</span>
          <span className="text-xs text-muted-foreground" title={n.reason}>{n.reason}</span>
        </div>
      ))}
    </div>
  );
}
