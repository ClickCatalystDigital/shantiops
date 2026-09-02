'use client';

// components/ReceiptPicker.jsx — gap-closure round, 2026-08-26 (S1/S6). Before this,
// lib/stock-receipts.js's createReceipt()/POST /api/stock-receipts had zero calling code anywhere
// in the app — a Stores user had no way to record "this delivery is from supplier X against PO Y,
// inward batch INW-####" at all. This is the one shared control, used by AddPieceDialog (S4) and
// the new Receive Batch / Receive Serial dialogs (S2/S3) — a single implementation so "how does
// Stores start a receipt" is answered once, not reinvented three times.
//
// Two modes in one control: pick a recent open receipt (the common case — one physical delivery
// often gets received in several separate piece/batch/serial calls), or create a new one inline.
// Optionally cross-references an existing Gate Inward Receipt (GIR) entry — S6 — without merging
// the two concepts: GIR stays a security log, this is a procurement receipt with real identity.
import { useEffect, useState } from 'react';
import { api, showToast } from '@/lib/client';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectGroup } from '@/components/ui/select';

// `requireInvoice` (Feature A, canonical Stores Receiving) — the official receiving action needs a
// real invoice number, unlike the pre-existing speculative piece-receiving path this control was
// originally built for. Presentation only (a required-marker + native `required`); the real
// enforcement is server-side in POST /api/bom-items/[id]/receive.
export default function ReceiptPicker({ value, onChange, requireInvoice = false }) {
  const [receipts, setReceipts] = useState(null);
  const [suppliers, setSuppliers] = useState([]);
  const [purchaseOrders, setPurchaseOrders] = useState([]);
  const [girEntries, setGirEntries] = useState([]);
  const [creating, setCreating] = useState(false);
  const [supplierId, setSupplierId] = useState('');
  const [poId, setPoId] = useState('');
  const [grnRef, setGrnRef] = useState('');
  const [invoiceNo, setInvoiceNo] = useState('');
  const [girId, setGirId] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api('/api/stock-receipts').then(setReceipts).catch(() => setReceipts([]));
    api('/api/suppliers').then(setSuppliers).catch(() => {});
    api('/api/purchase-orders').then(setPurchaseOrders).catch(() => {});
    api('/api/gate-inward-receipts').then(rows => setGirEntries(rows.filter(g => g.status === 'open'))).catch(() => {});
  }, []);

  async function create() {
    if (!supplierId) return showToast('Choose a supplier', 'error');
    if (requireInvoice && !grnRef.trim()) return showToast('Enter the GRN number', 'error');
    if (requireInvoice && !invoiceNo.trim()) return showToast('Enter the invoice number', 'error');
    setBusy(true);
    try {
      const result = await api('/api/stock-receipts', {
        method: 'POST',
        body: {
          supplier_id: Number(supplierId), po_id: poId ? Number(poId) : undefined,
          grn_ref: grnRef.trim() || undefined, invoice_no: invoiceNo.trim() || undefined,
          gate_inward_receipt_id: girId ? Number(girId) : undefined,
        },
      });
      showToast(`Receipt ${result.inward_batch_no} created`);
      setReceipts(prev => [{ id: result.id, inward_batch_no: result.inward_batch_no,
        supplier_name: suppliers.find(s => s.id === Number(supplierId))?.name }, ...(prev || [])]);
      onChange(result.id);
      setCreating(false);
    } catch (err) { showToast(err.message, 'error'); }
    setBusy(false);
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border p-3">
      <Label>Receipt (supplier / PO / inward batch)</Label>
      {!creating ? (
        <div className="flex flex-wrap items-center gap-2">
          <Select value={value ? String(value) : ''} onValueChange={v => onChange(v ? Number(v) : null)}>
            <SelectTrigger className="w-72">
              <SelectValue placeholder={requireInvoice ? 'Choose a receipt' : 'No receipt — receive speculatively'} />
            </SelectTrigger>
            <SelectContent><SelectGroup>
              {(receipts || []).map(r => (
                <SelectItem key={r.id} value={String(r.id)}>
                  {r.inward_batch_no}{r.supplier_name ? ` · ${r.supplier_name}` : ''}{r.po_no ? ` · PO ${r.po_no}` : ''}
                </SelectItem>
              ))}
            </SelectGroup></SelectContent>
          </Select>
          <Button type="button" size="sm" variant="outline" onClick={() => setCreating(true)}>New receipt</Button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <Select value={supplierId} onValueChange={setSupplierId}>
              <SelectTrigger className="w-56"><SelectValue placeholder="Supplier *" /></SelectTrigger>
              <SelectContent><SelectGroup>
                {suppliers.map(s => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}
              </SelectGroup></SelectContent>
            </Select>
            <Select value={poId} onValueChange={setPoId}>
              <SelectTrigger className="w-56"><SelectValue placeholder="PO (optional)" /></SelectTrigger>
              <SelectContent><SelectGroup>
                {purchaseOrders.map(po => <SelectItem key={po.id} value={String(po.id)}>{po.po_no}</SelectItem>)}
              </SelectGroup></SelectContent>
            </Select>
            <Input className="w-40" placeholder={requireInvoice ? 'GRN ref *' : 'GRN ref (optional)'}
              value={grnRef} onChange={e => setGrnRef(e.target.value)} required={requireInvoice} />
            <Input className="w-40" placeholder={requireInvoice ? 'Invoice No *' : 'Invoice No (optional)'}
              value={invoiceNo} onChange={e => setInvoiceNo(e.target.value)} required={requireInvoice} />
          </div>
          {girEntries.length > 0 && (
            <Select value={girId} onValueChange={setGirId}>
              <SelectTrigger className="w-72"><SelectValue placeholder="Link a gate entry (optional)" /></SelectTrigger>
              <SelectContent><SelectGroup>
                {girEntries.map(g => (
                  <SelectItem key={g.id} value={String(g.id)}>
                    GIR-{g.gir_no} · {g.vehicle_no || '—'} · {g.supplier_name || '—'}
                  </SelectItem>
                ))}
              </SelectGroup></SelectContent>
            </Select>
          )}
          <div className="flex gap-2">
            <Button type="button" size="sm" disabled={busy} onClick={create}>{busy ? 'Creating…' : 'Create receipt'}</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setCreating(false)}>Cancel</Button>
          </div>
        </div>
      )}
    </div>
  );
}
