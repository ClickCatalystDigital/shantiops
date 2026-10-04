'use client';

// Carrier and tracking details of a consignment, kept as business records: mode, transporter, vehicle,
// LR / RR / BL / AWB number (named by the mode), container, tracking link and expected delivery.
// Used on a packing list, on a shipment (applied to every list in it) and by Deliveries.
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { TRANSPORT_MODES, carrierDocLabel } from '@/lib/carrier.mjs';
import { showToast } from '@/lib/client';

export default function CarrierDialog({ open, onOpenChange, title = 'Carrier & tracking', description, initial, onSave }) {
  const [v, setV] = useState({});
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setV({ ...initial, transport_mode: initial?.transport_mode || 'road' }); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k, val) => setV(x => ({ ...x, [k]: val }));
  const mode = v.transport_mode || 'road';
  const text = (k, label, ph, type = 'text') => (
    <div className="flex flex-col gap-1.5"><Label className="text-xs">{label}</Label>
      <Input type={type} value={v[k] ?? ''} onChange={e => set(k, e.target.value)} placeholder={ph} /></div>
  );

  async function save() {
    setBusy(true);
    try { await onSave(v); onOpenChange(false); } catch (err) { showToast(err.message, 'error'); }
    setBusy(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description || 'Kept as a record for this delivery. You can fill it in or change it at any time, including after dispatch.'}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5"><Label className="text-xs">Mode of transport</Label>
            <Select value={mode} onValueChange={x => set('transport_mode', x)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{TRANSPORT_MODES.map(([k, label]) => <SelectItem key={k} value={k}>{label}</SelectItem>)}</SelectContent>
            </Select></div>
          {text('dispatch_through', mode === 'ship' ? 'Shipping line / forwarder' : 'Transporter', mode === 'ship' ? 'e.g. Maersk' : 'e.g. ABC Transport')}
          {text('carrier_doc_no', carrierDocLabel(mode), '')}
          {text('carrier_doc_date', 'Date on the document', '', 'date')}
          {mode === 'road' && text('vehicle_no', 'Vehicle no.', 'e.g. TS09 UB 1234')}
          {(mode === 'ship' || mode === 'rail') && text('container_no', mode === 'ship' ? 'Container no.' : 'Wagon / container no.', '')}
          {text('expected_delivery_date', 'Expected delivery', '', 'date')}
          <div className="sm:col-span-2">{text('tracking_url', 'Tracking link', 'https://…')}</div>
        </div>
        <DialogFooter className="m-0">
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
