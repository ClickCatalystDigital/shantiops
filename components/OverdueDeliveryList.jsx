'use client';

// components/OverdueDeliveryList.jsx — Procurement's "Overdues" tab: every already-committed
// (Ordered/Transit) item whose nearest expected date (a real Delivery Lot, or the RFQ-quoted
// fallback for one never scheduled) has passed. `items` comes from getOverdueDeliveries()
// (lib/data.js), already carrying attachDeliveryLotDates()'s nearest_expected_delivery/
// delivery_lots/all_expected_dates plus each item's supplier contact fields.
import { useState, useEffect, useCallback } from 'react';
import { api, showToast, formatDate } from '@/lib/client';
import { Card, CardContent } from './ui/card';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Textarea } from './ui/textarea';
import { TrashIcon } from 'lucide-react';
import { projectLabel } from '@/lib/project-label';
import { todayISO } from '@/lib/date';

function daysOverdue(dateStr) {
  const then = new Date(`${dateStr}T00:00:00`);
  const today = new Date(`${todayISO()}T00:00:00`);
  return Math.round((today - then) / 86400000);
}

function FollowupLog({ bomItemId }) {
  const [followups, setFollowups] = useState(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setFollowups(await api(`/api/bom-items/${bomItemId}/delivery-followups`)); }
    catch (err) { showToast(err.message, 'error'); }
  }, [bomItemId]);
  useEffect(() => { load(); }, [load]);
  if (followups === null) return <p className="py-2 text-xs text-muted-foreground">Loading…</p>;

  async function submit() {
    if (!note.trim()) return;
    setBusy(true);
    try {
      await api(`/api/bom-items/${bomItemId}/delivery-followups`, { method: 'POST', body: { note: note.trim() } });
      setNote('');
      await load();
    } catch (err) { showToast(err.message, 'error'); }
    setBusy(false);
  }

  async function remove(id) {
    try {
      await api(`/api/bom-items/${bomItemId}/delivery-followups/${id}`, { method: 'DELETE' });
      setFollowups(fs => fs.filter(f => f.id !== id));
    } catch (err) { showToast(err.message, 'error'); }
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border bg-muted/30 p-2">
      {followups.length === 0 && <p className="text-xs text-muted-foreground">No follow-ups logged yet.</p>}
      {followups.map(f => (
        <div key={f.id} className="flex items-start justify-between gap-2 rounded-md border bg-background px-2 py-1.5 text-xs">
          <div className="min-w-0">
            <p>{f.note}</p>
            <p className="mt-0.5 text-muted-foreground">{f.created_by || 'unknown'} · {formatDate(f.created_at)}</p>
          </div>
          <button type="button" aria-label="Remove follow-up" onClick={() => remove(f.id)}
            className="shrink-0 text-muted-foreground hover:text-destructive">
            <TrashIcon className="size-3.5" />
          </button>
        </div>
      ))}
      <div className="flex gap-2">
        <Textarea value={note} onChange={e => setNote(e.target.value)} placeholder="Reason / what the supplier said…" className="min-h-16 text-sm" />
        <Button size="sm" disabled={busy || !note.trim()} onClick={submit} className="self-end shrink-0">Add follow-up</Button>
      </div>
    </div>
  );
}

function OverdueRow({ it }) {
  const [expanded, setExpanded] = useState(false);
  const days = daysOverdue(it.nearest_expected_delivery);
  const poNos = [...new Set(it.delivery_lots.map(l => l.po_no))];

  return (
    <div className="flex flex-col gap-2 border-b py-3 last:border-b-0">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium">{it.material_description}</p>
          <p className="truncate text-xs text-muted-foreground">
            {projectLabel(it)} · {it.supplier_name || 'no supplier on record'}
            {poNos.length > 0 ? ` · ${poNos.join(', ')}` : ' · not yet scheduled into a delivery lot'}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge variant="outline" className="text-danger">{days} day{days === 1 ? '' : 's'} overdue</Badge>
          <span className="text-xs text-muted-foreground">Expected {formatDate(it.nearest_expected_delivery)}</span>
        </div>
      </div>
      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
        {it.contact_person && <span>{it.contact_person}</span>}
        {it.phone && <a href={`tel:${it.phone}`} className="text-primary hover:underline">{it.phone}</a>}
        {it.email && <a href={`mailto:${it.email}`} className="text-primary hover:underline">{it.email}</a>}
        {!it.phone && !it.email && !it.contact_person && <span>No contact details on record for this supplier.</span>}
      </div>
      <button type="button" className="w-fit text-xs text-primary hover:underline" onClick={() => setExpanded(v => !v)}>
        {expanded ? 'Hide' : 'Show'} follow-ups
      </button>
      {expanded && <FollowupLog bomItemId={it.id} />}
    </div>
  );
}

export default function OverdueDeliveryList({ items, q }) {
  const needle = q.trim().toLowerCase();
  const shown = items
    .filter(it => !needle || it.material_description.toLowerCase().includes(needle) || (it.supplier_name || '').toLowerCase().includes(needle))
    .sort((a, b) => a.nearest_expected_delivery.localeCompare(b.nearest_expected_delivery));

  return (
    <Card>
      <CardContent className="flex flex-col pt-4">
        {shown.length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">Nothing overdue right now.</p>
        )}
        {shown.map(it => <OverdueRow key={it.id} it={it} />)}
      </CardContent>
    </Card>
  );
}
