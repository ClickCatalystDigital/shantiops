'use client';

// Procurement's own worklist, above the raw BOM table: where each active item sits in the real
// process (sourcing -> PO placed -> in transit), plus cancel-requests raised by Design/Engineering
// waiting on Procurement to accept. Derived entirely from the bom/tasks props DepartmentPanel
// already fetches — no new query. Accepting flips bom_items.purchase_status to CANCELLED via
// POST /api/production/tasks/accept-cancellations (§ Procurement cancel-request flow).
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, showToast } from '@/lib/client';
import Link from 'next/link';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from './ui/card';
import { Checkbox } from './ui/checkbox';
import { Button } from './ui/button';

function Stat({ label, value }) {
  return (
    <div className="rounded-md bg-muted/40 p-3 text-center">
      <p className="text-xl font-semibold tnum">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

export default function ProcurementQueue({ bom = [], tasks = [] }) {
  const router = useRouter();
  const [selected, setSelected] = useState(new Set());
  const [busy, setBusy] = useState(false);

  const active = bom.filter(b => !['CLOSED', 'RECEIVED', 'CANCELLED'].includes(b.purchase_status));
  const sourcing = active.filter(b => (!b.purchase_status || b.purchase_status === 'PENDING') && !b.po_ref);
  const poPlaced = active.filter(b => (!b.purchase_status || b.purchase_status === 'PENDING') && b.po_ref);
  const transit = active.filter(b => b.purchase_status === 'TRANSIT');

  const cancelRequests = tasks.filter(t => t.bom_item_id && t.department === 'Procurement' && t.status === 'open');

  function toggle(id) {
    setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function toggleAll() {
    setSelected(s => s.size === cancelRequests.length ? new Set() : new Set(cancelRequests.map(t => t.id)));
  }
  async function accept() {
    if (!selected.size) return;
    setBusy(true);
    try {
      await api('/api/production/tasks/accept-cancellations', { method: 'POST', body: { task_ids: [...selected] } });
      showToast(`${selected.size} item${selected.size !== 1 ? 's' : ''} cancelled`);
      setSelected(new Set());
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); }
    setBusy(false);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Procurement queue</CardTitle>
        <CardAction>
          <Button asChild size="sm" variant="outline">
            {/* Sourcing/quotes/POs are cross-project — that workspace lives at /procurement, not
                scoped to this one project (§5a). */}
            <Link href="/procurement">Open Procurement workspace →</Link>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid grid-cols-3 gap-3">
          <Stat label="Sourcing" value={sourcing.length} />
          <Stat label="PO placed" value={poPlaced.length} />
          <Stat label="In transit" value={transit.length} />
        </div>

        {cancelRequests.length > 0 && (
          <div className="flex flex-col gap-2 rounded-md border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="flex items-center gap-2 text-sm font-medium">
                <Checkbox checked={selected.size === cancelRequests.length} onCheckedChange={toggleAll} />
                Cancel requests ({cancelRequests.length})
              </label>
              <Button size="sm" disabled={busy || !selected.size} onClick={accept}>
                Accept selected{selected.size ? ` (${selected.size})` : ''}
              </Button>
            </div>
            <div className="flex flex-col divide-y">
              {cancelRequests.map(t => (
                <label key={t.id} className="flex items-center gap-2 py-1.5 text-sm">
                  <Checkbox checked={selected.has(t.id)} onCheckedChange={() => toggle(t.id)} />
                  <span className="min-w-0 flex-1 truncate">{t.title}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">from {t.from_department}</span>
                </label>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
