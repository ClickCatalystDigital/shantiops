'use client';

// V2-CHANGES.md Phase 5.1 — Create RFQ, from Enquiry's bulk selection: confirm items -> pick
// suppliers (searchable multi-select over the real 445-row Group 3 import) -> in-system draft
// preview (D13: recipients + composed message + item list + each supplier's portal link) ->
// WhatsApp wa.me click-send + an Email button showing the same draft (D13/D19 — no auto-send).
import { useState } from 'react';
import { api, showToast } from '@/lib/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Badge } from './ui/badge';

// India-only assumption (this business), same as the enroll-code precedent elsewhere in the app —
// a 10-digit local number gets the country code prefixed; anything else (already has one, or a
// landline with an STD code) is passed through as typed.
function waDigits(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return null;
  return digits.length === 10 ? `91${digits}` : digits;
}

function composeMessage({ rfqNo, supplierName, items, portalUrl }) {
  // Gap #2 (2026-09-04) — items already carry qty_breakdown (getSourcingItems(), §5be); this
  // composer just never read it, so a supplier quoting a multiplied line saw the raw per-unit
  // figure ("Qty 2 Mtrs") with no sense of the real total order size.
  const itemLines = items.map((it, i) =>
    `${i + 1}. ${it.material_description} — Qty ${it.qty_text || '—'}${it.qty_breakdown ? ` (${it.qty_breakdown.label})` : ''}`
  ).join('\n');
  return `RFQ ${rfqNo} — Shanti Boilers

Dear ${supplierName},

Request for quotation. Please submit your rates for the items below through your private link (no login needed):
${portalUrl}

Items:
${itemLines}

The link is valid for 14 days. Kindly include unit price, payment terms, and expected delivery.

Regards,
Procurement — Shanti Boilers`;
}

function SupplierDraftCard({ supplier, rfqNo, items, onMarkSent }) {
  const portalUrl = `${window.location.origin}/rfq/${supplier.token}`;
  const message = composeMessage({ rfqNo, supplierName: supplier.supplier_name, items, portalUrl });
  const digits = waDigits(supplier.phone);

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4 text-sm">
      <div className="flex items-center justify-between">
        <span className="font-medium">{supplier.supplier_name}</span>
        <span className="text-xs text-muted-foreground">{supplier.phone || 'no phone'} · {supplier.email || 'no email'}</span>
      </div>
      <details className="group rounded-md bg-muted/30 text-xs text-muted-foreground">
        <summary className="cursor-pointer select-none px-3 py-1.5 hover:text-foreground">Message preview</summary>
        <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap px-3 pb-3">{message}</pre>
      </details>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={!digits} asChild={!!digits}
          onClick={!digits ? undefined : () => onMarkSent(supplier.supplier_id)}>
          {digits ? (
            <a href={`https://wa.me/${digits}?text=${encodeURIComponent(message)}`} target="_blank" rel="noreferrer">WhatsApp</a>
          ) : 'WhatsApp (no phone)'}
        </Button>
        <Button size="sm" variant="outline" disabled={!supplier.email} asChild={!!supplier.email}
          onClick={!supplier.email ? undefined : () => onMarkSent(supplier.supplier_id)}>
          {supplier.email ? (
            <a href={`mailto:${supplier.email}?subject=${encodeURIComponent(`RFQ ${rfqNo} — Shanti Boilers`)}&body=${encodeURIComponent(message)}`}>Email</a>
          ) : 'Email (no address)'}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => { navigator.clipboard.writeText(portalUrl); showToast('Link copied'); }}>
          Copy link
        </Button>
        {supplier.sent_at && <Badge variant="outline" className="ml-auto text-muted-foreground">Sent</Badge>}
      </div>
    </div>
  );
}

export default function CreateRfqDialog({ items, suppliers, router, onClose, onCreated }) {
  const [step, setStep] = useState('suppliers'); // suppliers -> preview
  const [supplierSearch, setSupplierSearch] = useState('');
  const [selectedSupplierIds, setSelectedSupplierIds] = useState(new Set());
  const [busy, setBusy] = useState(false);
  const [rfq, setRfq] = useState(null);

  const needle = supplierSearch.trim().toLowerCase();
  const shownSuppliers = suppliers.filter(s => !needle || s.name.toLowerCase().includes(needle));

  function toggleSupplier(id) {
    setSelectedSupplierIds(s => { const next = new Set(s); next.has(id) ? next.delete(id) : next.add(id); return next; });
  }

  async function create() {
    if (!selectedSupplierIds.size) return showToast('Pick at least one supplier', 'error');
    setBusy(true);
    try {
      const detail = await api('/api/rfqs', {
        method: 'POST',
        body: { bom_item_ids: items.map(it => it.id), supplier_ids: [...selectedSupplierIds] },
      });
      setRfq(detail);
      setStep('preview');
      showToast(`${detail.rfq_no} created`);
    } catch (err) { showToast(err.message, 'error'); }
    setBusy(false);
  }

  async function markSent(supplierId) {
    try {
      await api(`/api/rfqs/${rfq.id}`, { method: 'PATCH', body: { supplier_id: supplierId, action: 'sent' } });
      setRfq(r => ({ ...r, suppliers: r.suppliers.map(s => s.supplier_id === supplierId ? { ...s, sent_at: new Date().toISOString() } : s) }));
    } catch { /* best-effort — the click itself already opened WhatsApp/mail */ }
  }

  return (
    <Dialog open onOpenChange={o => { if (!o) (step === 'preview' ? onCreated() : onClose()); }}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-4xl">
        {step === 'suppliers' && (
          <>
            <DialogHeader>
              <DialogTitle>Create RFQ — {items.length} item{items.length !== 1 ? 's' : ''}</DialogTitle>
            </DialogHeader>
            <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
              <div className="flex flex-col gap-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Items</p>
                <ul className="max-h-80 divide-y overflow-y-auto rounded-lg border bg-muted/20 text-sm">
                  {items.map(it => (
                    <li key={it.id} className="flex items-start justify-between gap-2 px-3 py-2">
                      <span className="min-w-0">{it.material_description}</span>
                      <span className="shrink-0 rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground">{it.project_no}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="flex flex-col gap-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Suppliers</p>
                <Input value={supplierSearch} onChange={e => setSupplierSearch(e.target.value)} placeholder="Search suppliers…" />
                <div className="max-h-72 overflow-y-auto rounded-lg border">
                  {shownSuppliers.slice(0, 200).map(s => (
                    <label key={s.id} className="flex cursor-pointer items-center gap-3 border-b px-3 py-2 text-sm last:border-b-0 hover:bg-muted/40">
                      <input type="checkbox" className="size-4" checked={selectedSupplierIds.has(s.id)} onChange={() => toggleSupplier(s.id)} />
                      <span className="min-w-0 flex-1 truncate">{s.name}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">{s.city || ''}</span>
                    </label>
                  ))}
                  {shownSuppliers.length === 0 && <p className="p-3 text-center text-xs text-muted-foreground">No suppliers match.</p>}
                </div>
              </div>
            </div>
            <DialogFooter className="items-center sm:justify-between">
              <span className="text-xs text-muted-foreground">{selectedSupplierIds.size} supplier{selectedSupplierIds.size === 1 ? '' : 's'} selected</span>
              <div className="flex gap-2">
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button disabled={busy} onClick={create}>{busy ? 'Creating…' : 'Create RFQ'}</Button>
              </div>
            </DialogFooter>
          </>
        )}
        {step === 'preview' && rfq && (
          <>
            <DialogHeader>
              <DialogTitle>{rfq.rfq_no} — review & send</DialogTitle>
            </DialogHeader>
            <div className="grid gap-3 md:grid-cols-2">
              {rfq.suppliers.map(s => (
                <SupplierDraftCard key={s.id} supplier={s} rfqNo={rfq.rfq_no} items={rfq.items} onMarkSent={markSent} />
              ))}
            </div>
            <DialogFooter>
              <Button onClick={onCreated}>Done</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
