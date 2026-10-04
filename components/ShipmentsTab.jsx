'use client';

// Dispatch > Shipments: packing lists that leave together. One card per shipment (SHP-xxxx) with its
// lists, the vehicle (optionally applied to every list), one combined printout, "Dispatch all", and
// Split up to undo it. The lists themselves are still dispatched, approved and invoiced one by one.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, showToast } from '@/lib/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import ShipmentDialog from '@/components/ShipmentDialog';
import CarrierDialog from '@/components/CarrierDialog';
import { carrierSummary } from '@/lib/carrier.mjs';
import { formatDate } from '@/lib/client';
import { PlusIcon, FileTextIcon, UndoIcon, TruckIcon, XIcon, LayersIcon } from 'lucide-react';

const STAGE = { draft: 'Draft', packed: 'Ready', dispatched: 'Dispatched' };

function ShipmentCard({ sh, allLists }) {
  const router = useRouter();
  const [carrierOpen, setCarrierOpen] = useState(false);
  const [ewb, setEwb] = useState(sh.consolidated_eway_bill_no || '');
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const patch = body => api(`/api/shipments/${sh.id}`, { method: 'PATCH', body });
  const run = async (fn, ok) => { setBusy(true); try { await fn(); if (ok) showToast(ok); router.refresh(); } catch (e) { showToast(e.message, 'error'); } setBusy(false); };
  const ready = sh.lists.filter(l => l.status === 'packed');
  const done = sh.lists.every(l => l.status === 'dispatched');      // fully left: a historic record, read-only
  const anyLeft = sh.lists.some(l => l.status === 'dispatched');   // some already left: they stay in the shipment

  async function dispatchAll() {
    if (!confirm(`Dispatch ${ready.length} ready list${ready.length === 1 ? '' : 's'} in ${sh.shipment_no} now? Each list still needs its own approval.`)) return;
    setBusy(true);
    const failed = [];
    for (const l of ready) {
      try { await api(`/api/packing/${l.id}`, { method: 'PATCH', body: { status: 'dispatched' } }); }
      catch (e) { failed.push(`${l.packing_no}: ${e.message}`); }
    }
    showToast(failed.length ? `${ready.length - failed.length} dispatched. ${failed.join(' · ')}` : `${ready.length} list${ready.length === 1 ? '' : 's'} dispatched`, failed.length ? 'error' : undefined);
    router.refresh();
    setBusy(false);
  }

  return (
    <section className="overflow-hidden rounded-xl border bg-card">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
        <LayersIcon className="size-4 text-muted-foreground" />
        <span className="font-semibold tnum">{sh.shipment_no}</span>
        <span className="text-sm">{sh.customer_name}</span>
        <span className="min-w-0 truncate text-xs text-muted-foreground">{(sh.customer_address || '').replace(/\s+/g, ' ')}</span>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm"><a href={`/api/shipments/${sh.id}/pdf`} target="_blank" rel="noreferrer"><FileTextIcon className="size-3.5" /> Combined PDF</a></Button>
          {!done && <Button variant="outline" size="sm" onClick={() => setAdding(true)}><PlusIcon className="size-3.5" /> Add lists</Button>}
          {!done && <Button variant="outline" size="sm" disabled={busy || !ready.length} onClick={dispatchAll}><TruckIcon className="size-3.5" /> Dispatch all</Button>}
          {!done && !anyLeft && <Button variant="ghost" size="sm" disabled={busy} onClick={() => confirm(`Split ${sh.shipment_no} back into separate lists?`) && run(() => patch({ action: 'split' }), `${sh.shipment_no} split up`)}><UndoIcon className="size-3.5" /> Split up</Button>}
        </div>
      </div>
      <div className="divide-y border-t">
        {sh.lists.map(l => (
          <div key={l.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm">
            <Link href={`/packing/${l.id}`} className="font-medium tnum underline-offset-2 hover:underline">{l.packing_no}</Link>
            <span className="text-xs text-muted-foreground">{l.project_no || 'no project'}</span>
            <Badge variant="outline" className="text-[10px]">{STAGE[l.status] || l.status}</Badge>
            {l.status !== 'dispatched' && l.approval_status && <Badge variant="outline" className="text-[10px]">Review: {l.approval_status}</Badge>}
            <span className="text-xs text-muted-foreground tnum">{l.item_count} line{l.item_count === 1 ? '' : 's'}</span>
            <span className="text-xs text-muted-foreground tnum">{l.eway_bill_no ? `E-way bill ${l.eway_bill_no}` : 'No e-way bill'}</span>
            {l.status !== 'dispatched' && <Button variant="ghost" size="sm" className="ml-auto h-7 gap-1 text-xs" disabled={busy}
              onClick={() => run(() => patch({ action: 'remove', list_id: l.id }), `${l.packing_no} taken out of ${sh.shipment_no}`)}><XIcon className="size-3" /> Take out</Button>}
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t bg-muted/20 px-4 py-2.5">
        <span className="min-w-0 text-xs text-muted-foreground">
          {carrierSummary(sh, formatDate) || 'No carrier details yet'}
          {sh.tracking_url && <> · <a href={sh.tracking_url} target="_blank" rel="noreferrer noopener" className="underline underline-offset-2">Open tracking</a></>}
        </span>
        <Button size="sm" variant="outline" className="ml-auto" onClick={() => setCarrierOpen(true)}>Carrier details</Button>
        <span className="mx-1 hidden h-5 border-l sm:block" />
        <Input value={ewb} onChange={e => setEwb(e.target.value)} placeholder="Consolidated e-way bill no. (12 digits)" className="h-8 w-60" inputMode="numeric" />
        <Button size="sm" variant="outline" disabled={busy || ewb === (sh.consolidated_eway_bill_no || '')} onClick={() => run(() => patch({ action: 'consolidated_ewb', consolidated_eway_bill_no: ewb }), 'Saved')}>Save</Button>
      </div>
      <CarrierDialog open={carrierOpen} onOpenChange={setCarrierOpen} title={`Carrier & tracking · ${sh.shipment_no}`}
        description="Applied to every packing list in this shipment, including ones already dispatched." initial={sh}
        onSave={async v => { await patch({ action: 'transport', apply: true, ...v }); showToast('Applied to every list in the shipment'); router.refresh(); }} />
      {!done && <ShipmentDialog open={adding} onOpenChange={setAdding} lists={allLists} shipment={sh} />}
    </section>
  );
}

export default function ShipmentsTab({ shipments, lists }) {
  const [open, setOpen] = useState(false);
  // A shipment whose lists have all left moves under "Dispatched".
  const active = shipments.filter(sh => sh.lists.some(l => l.status !== 'dispatched'));
  const gone = shipments.filter(sh => sh.lists.every(l => l.status === 'dispatched'));
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <p className="text-sm text-muted-foreground">Packing lists that leave together to the same address.</p>
        <Button size="sm" className="ml-auto" onClick={() => setOpen(true)}><PlusIcon className="size-3.5" /> Combine lists</Button>
      </div>
      {!active.length && !gone.length && (
        <div className="rounded-xl border border-dashed py-12 text-center text-sm text-muted-foreground">
          <LayersIcon className="mx-auto mb-2 size-6 opacity-40" />
          No shipments. Combine two or more packing lists that go to the same address on one truck.
        </div>
      )}
      {active.map(sh => <ShipmentCard key={sh.id} sh={sh} allLists={lists} />)}
      {gone.length > 0 && (
        <>
          <h3 className="mt-2 text-sm font-semibold text-muted-foreground">Dispatched</h3>
          {gone.slice(0, 10).map(sh => <ShipmentCard key={sh.id} sh={sh} allLists={lists} />)}
        </>
      )}
      <ShipmentDialog open={open} onOpenChange={setOpen} lists={lists} />
    </div>
  );
}
