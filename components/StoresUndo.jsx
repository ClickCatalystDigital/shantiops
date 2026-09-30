'use client';

// Allocator -> "Routed" list: lines Stores has already sent to Production or Dispatch that nothing has been
// built on yet (no Production request, no packing list). Undo puts the line back in the Allocator queue.
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { UndoIcon } from 'lucide-react';
import { api, showToast, formatDate } from '@/lib/client';

export default function RoutedItemsCard() {
  const router = useRouter();
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(null);

  async function load() {
    try { setRows(await api('/api/stores/routed-items')); } catch (e) { showToast(e.message, 'error'); setRows([]); }
  }
  useEffect(() => { load(); }, []);

  async function undo(r) {
    setBusy(r.id);
    try {
      await api(`/api/bom-items/${r.id}/route-self`, { method: 'DELETE' });
      showToast('Routing undone — back in the queue above');
      await load(); router.refresh();
    } catch (e) { showToast(e.message, 'error'); }
    setBusy(null);
  }

  if (rows === null) return <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Routed</CardTitle>
        <p className="text-sm text-muted-foreground">Sent to Production or Dispatch, nothing built on it yet. Undo to decide again. A Production notification that already went out can't be recalled.</p>
      </CardHeader>
      <CardContent className="divide-y text-sm">
        {rows.length === 0 && <p className="py-6 text-center text-muted-foreground">Nothing routed that can still be changed.</p>}
        {rows.map(r => (
          <div key={r.id} className="flex flex-wrap items-center gap-3 py-2">
            <div className="min-w-0 flex-1">
              <span className="font-medium">{r.material_description}</span>
              <div className="text-xs text-muted-foreground">{r.project_no} · {r.qty_text || '—'} · by {r.decided_by || '—'}{r.decided_at ? ` · ${formatDate(r.decided_at)}` : ''}</div>
            </div>
            <Badge variant="outline">{r.routed_to === 'production' ? 'Production' : 'Dispatch'}</Badge>
            <Button size="sm" variant="outline" disabled={busy === r.id} onClick={() => undo(r)}><UndoIcon className="size-3.5" /> Undo</Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
