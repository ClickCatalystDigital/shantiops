import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';

// The packing board — Draft → Ready → Dispatched. Now a plain { lists }-prop component (was a
// self-fetching async Server Component) — DispatchWorkspace.jsx (a Client Component, for tab-
// switching state) can't import/render a Server Component directly, and Deliveries/Documents need
// the exact same list anyway, so the fetch moved up to app/dispatch/page.js, once.
// Label fixed 'Pending' -> 'Draft' to match the status value and the workspace's own stat-pill
// row/terminology — DispatchFlow.jsx (a different page, the Operations tab's flow diagram) is a
// separate component and deliberately left with its own wording, out of scope here.
const COLUMNS = [
  { key: 'draft', label: 'Draft', tone: 'bg-warning/10 text-warning ring-warning/20' },
  { key: 'packed', label: 'Ready', tone: 'bg-info/10 text-info ring-info/20' },
  { key: 'dispatched', label: 'Dispatched', tone: 'bg-success/10 text-success ring-success/20' },
];

// statusFilter (optional): 'draft' | 'packed' | 'dispatched' — when set, renders only that one
// column, full width. The clear/toggle affordance lives in the caller (PackingListsTab), which owns
// the filter state and the pill click handlers.
export default function DispatchBoard({ lists, statusFilter = null }) {
  const byStatus = { draft: [], packed: [], dispatched: [] };
  lists.forEach(l => { (byStatus[l.status] || byStatus.draft).push(l); });
  const columns = statusFilter ? COLUMNS.filter(c => c.key === statusFilter) : COLUMNS;

  return (
    <div className={`grid gap-4 ${statusFilter ? 'grid-cols-1' : 'md:grid-cols-3'}`}>
      {columns.map(col => (
        <div key={col.key} className="flex flex-col gap-3">
          <div className="flex items-center justify-between px-1">
            <span className="text-sm font-semibold">{col.label}</span>
            <span className="text-xs text-muted-foreground tnum">{byStatus[col.key].length}</span>
          </div>
          {byStatus[col.key].map(l => (
            <Link key={l.id} href={`/packing/${l.id}`} className="group">
              <Card className="transition-colors group-hover:border-primary/40 group-hover:bg-accent/40">
                <CardContent className="flex flex-col gap-1 py-3">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold tnum">{l.packing_no}</span>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${col.tone}`}>{col.label}</span>
                  </div>
                  <div className="text-sm">{l.customer_name}</div>
                  <div className="text-xs text-muted-foreground">
                    {l.invoice_no || 'No invoice'} · {l.item_count} item{l.item_count !== 1 ? 's' : ''}
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
          {byStatus[col.key].length === 0 && (
            <div className="rounded-lg border border-dashed py-6 text-center text-xs text-muted-foreground">None</div>
          )}
        </div>
      ))}
    </div>
  );
}
