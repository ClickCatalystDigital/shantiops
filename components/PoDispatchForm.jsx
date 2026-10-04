'use client';

// Delivery details of goods dispatched against a purchase order: which lines and how many are on the
// truck, the carrier (LR / BL…), tracking link, expected arrival, and the supplier's invoice and
// e-way bill numbers. One form for the supplier's own link and for Procurement. `items` are the PO
// lines with what is still to dispatch; `initial` fills it when editing.
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { TRANSPORT_MODES, carrierDocLabel } from '@/lib/carrier.mjs';

const today = () => new Date().toISOString().slice(0, 10);

export default function PoDispatchForm({ items, initial = null, submitLabel = 'Save delivery details', busy = false, onSubmit, onCancel }) {
  const editing = !!initial;
  const [v, setV] = useState(() => ({
    dispatched_on: initial?.dispatched_on || today(), transport_mode: initial?.transport_mode || 'road', dispatch_through: initial?.dispatch_through || '',
    vehicle_no: initial?.vehicle_no || '', carrier_doc_no: initial?.carrier_doc_no || '', carrier_doc_date: initial?.carrier_doc_date || '',
    container_no: initial?.container_no || '', tracking_url: initial?.tracking_url || '', expected_delivery_date: initial?.expected_delivery_date || '',
    invoice_no: initial?.invoice_no || '', invoice_date: initial?.invoice_date || '', eway_bill_no: initial?.eway_bill_no || '', notes: initial?.notes || '',
  }));
  // Quantity per line: blank = not on this truck. New dispatch starts with everything still to go.
  const [qty, setQty] = useState(() => {
    const own = Object.fromEntries((initial?.items || []).map(i => [i.po_item_id, i.qty]));
    return Object.fromEntries(items.map(it => [it.id, editing ? (own[it.id] ?? '') : (it.remaining > 0 ? it.remaining : '')]));
  });
  const set = (k, val) => setV(x => ({ ...x, [k]: val }));
  const mode = v.transport_mode;
  const field = (k, label, type = 'text', ph = '') => (
    <div className="flex flex-col gap-1.5"><Label className="text-xs">{label}</Label>
      <Input type={type} value={v[k]} placeholder={ph} onChange={e => set(k, e.target.value)} /></div>
  );
  // While editing, a line's own earlier quantity is available again.
  const room = it => it.remaining + (editing ? Number((initial.items || []).find(i => i.po_item_id === it.id)?.qty || 0) : 0);

  function submit() {
    onSubmit({ ...v, items: items.map(it => ({ po_item_id: it.id, qty: Number(qty[it.id]) || 0 })).filter(i => i.qty > 0) });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-hidden rounded-lg border">
        <div className="bg-muted/40 px-3 py-1.5 text-xs font-medium text-muted-foreground">Lines on this dispatch</div>
        <div className="divide-y">
          {items.map(it => {
            const max = room(it);
            return (
              <div key={it.id} className={`flex items-center gap-3 px-3 py-2 text-sm ${max <= 0 ? 'opacity-50' : ''}`}>
                <Checkbox checked={Number(qty[it.id]) > 0} disabled={max <= 0}
                  onCheckedChange={c => setQty(q => ({ ...q, [it.id]: c ? max : '' }))} />
                <span className="min-w-0 flex-1">{it.description}</span>
                <span className="shrink-0 text-xs text-muted-foreground tnum">{max <= 0 ? 'all sent' : `${max}${it.uom ? ` ${it.uom}` : ''} to go`}</span>
                <Input type="number" min="0" max={max} step="any" disabled={max <= 0} value={qty[it.id]} className="h-8 w-24"
                  onChange={e => setQty(q => ({ ...q, [it.id]: e.target.value }))} />
              </div>
            );
          })}
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {field('dispatched_on', 'Dispatched on *', 'date')}
        {field('expected_delivery_date', 'Expected to reach us', 'date')}
        <div className="flex flex-col gap-1.5"><Label className="text-xs">Mode of transport</Label>
          <Select value={mode} onValueChange={x => set('transport_mode', x)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{TRANSPORT_MODES.map(([k, label]) => <SelectItem key={k} value={k}>{label}</SelectItem>)}</SelectContent>
          </Select></div>
        {field('dispatch_through', mode === 'ship' ? 'Shipping line / forwarder' : 'Transporter')}
        {field('carrier_doc_no', carrierDocLabel(mode))}
        {field('carrier_doc_date', 'Date on that document', 'date')}
        {mode === 'road' && field('vehicle_no', 'Vehicle no.')}
        {(mode === 'ship' || mode === 'rail') && field('container_no', mode === 'ship' ? 'Container no.' : 'Wagon / container no.')}
        <div className="sm:col-span-2">{field('tracking_url', 'Tracking link (if you have one)', 'text', 'https://…')}</div>
        {field('invoice_no', 'Your invoice no.')}
        {field('invoice_date', 'Invoice date', 'date')}
        {field('eway_bill_no', 'E-way bill no.')}
        <div className="flex flex-col gap-1.5 sm:col-span-2"><Label className="text-xs">Notes</Label>
          <Textarea value={v.notes} onChange={e => set('notes', e.target.value)} rows={2} /></div>
      </div>
      <div className="flex justify-end gap-2">
        {onCancel && <Button variant="outline" disabled={busy} onClick={onCancel}>Cancel</Button>}
        <Button disabled={busy} onClick={submit}>{busy ? 'Saving…' : submitLabel}</Button>
      </div>
    </div>
  );
}
