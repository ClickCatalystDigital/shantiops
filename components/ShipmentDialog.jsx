'use client';

// Combine packing lists into one shipment (SHP-xxxx), or add more lists to an existing one. The lists
// keep their own PL numbers and approvals; a shipment groups them for one vehicle and one printout.
// Rules (same address / not dispatched / not already in a shipment) are shared with the API.
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, showToast } from '@/lib/client';
import { checkCombinable } from '@/lib/shipments.mjs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { SearchIcon, AlertTriangleIcon } from 'lucide-react';

const STAGE = { draft: 'Draft', packed: 'Ready' };

export default function ShipmentDialog({ open, onOpenChange, lists, shipment = null }) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState(new Set());
  const [vehicle, setVehicle] = useState('');
  const [through, setThrough] = useState('');
  const [busy, setBusy] = useState(false);

  // Lists that can still join: not dispatched, and not already in a shipment.
  const candidates = useMemo(() => lists.filter(l => l.status !== 'dispatched' && !l.shipment_id), [lists]);
  const needle = q.trim().toLowerCase();
  const shown = candidates.filter(l => !needle || [l.packing_no, l.project_no, l.customer_name, l.customer_address].some(v => String(v || '').toLowerCase().includes(needle)));
  const chosen = candidates.filter(l => picked.has(l.id));
  const members = shipment ? lists.filter(l => l.shipment_id === shipment.id) : [];
  const check = chosen.length ? checkCombinable([...members, ...chosen], shipment?.id || null) : null;
  const toggle = id => setPicked(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });

  async function save() {
    setBusy(true);
    try {
      const ids = chosen.map(l => l.id);
      if (shipment) await api(`/api/shipments/${shipment.id}`, { method: 'PATCH', body: { action: 'add', list_ids: ids } });
      else {
        const r = await api('/api/shipments', { method: 'POST', body: { list_ids: ids, vehicle_no: vehicle, dispatch_through: through } });
        showToast(`Shipment ${r.shipment_no} created`);
      }
      setPicked(new Set()); setVehicle(''); setThrough('');
      onOpenChange(false);
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); }
    setBusy(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{shipment ? `Add lists to ${shipment.shipment_no}` : 'Combine into a shipment'}</DialogTitle>
          <DialogDescription>
            Packing lists that leave together to the same address. Each list keeps its own number and approvals. You can split them up again.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search list, project, customer, address…" className="h-9 pl-9" />
          </div>
          <div className="max-h-64 divide-y overflow-y-auto rounded-lg border">
            {shown.length === 0 && <p className="px-3 py-6 text-center text-sm text-muted-foreground">No lists available. Dispatched lists and lists already in a shipment can't be added.</p>}
            {shown.map(l => (
              <label key={l.id} className="flex cursor-pointer items-start gap-3 px-3 py-2 text-sm hover:bg-muted/40">
                <Checkbox checked={picked.has(l.id)} onCheckedChange={() => toggle(l.id)} className="mt-1" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2">
                    <span className="font-medium tnum">{l.packing_no}</span>
                    <span className="text-xs text-muted-foreground">{l.project_no || 'no project'}</span>
                    <Badge variant="outline" className="text-[10px]">{STAGE[l.status] || l.status}</Badge>
                  </div>
                  <div className="truncate text-xs text-muted-foreground">{l.customer_name}{l.customer_address ? ` · ${l.customer_address.replace(/\s+/g, ' ')}` : ' · no address on the list'}</div>
                </div>
                <span className="shrink-0 text-xs text-muted-foreground tnum">{l.item_count} line{l.item_count === 1 ? '' : 's'}</span>
              </label>
            ))}
          </div>
          {check && !check.ok && (
            <div className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger-surface px-3 py-2 text-xs text-danger">
              <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" /><span>{check.problems.join(' ')}</span>
            </div>
          )}
          {check?.ok && check.warnings.length > 0 && (
            <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning-surface px-3 py-2 text-xs text-warning">
              <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" /><span>{check.warnings.join(' ')}</span>
            </div>
          )}
          {!shipment && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5"><Label>Vehicle no. <span className="font-normal text-muted-foreground">(optional)</span></Label>
                <Input value={vehicle} onChange={e => setVehicle(e.target.value)} placeholder="e.g. TS09 UB 1234" /></div>
              <div className="flex flex-col gap-1.5"><Label>Dispatch through <span className="font-normal text-muted-foreground">(optional)</span></Label>
                <Input value={through} onChange={e => setThrough(e.target.value)} placeholder="Transporter" /></div>
            </div>
          )}
        </div>
        <DialogFooter className="m-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={busy || !check || !check.ok} onClick={save}>
            {busy ? 'Saving…' : shipment ? `Add ${chosen.length} list${chosen.length === 1 ? '' : 's'}` : `Combine ${chosen.length || ''} lists`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
