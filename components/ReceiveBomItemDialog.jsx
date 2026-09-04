'use client';

// components/ReceiveBomItemDialog.jsx — Feature A, the canonical Stores Receiving action's UI.
// Replaces free-text GRN editing for any BOM line that hasn't been received yet: a mandatory
// receipt (supplier/GRN/invoice, via ReceiptPicker) + the received quantity + whichever received_*
// fields the line's own requires_* flags demand. Submits to POST /api/bom-items/[id]/receive —
// the one place a Stores user can move a line into 'Received'.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, showToast } from '@/lib/client';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import ReceiptPicker from '@/components/ReceiptPicker';

const RECEIVED_FIELD_LABELS = {
  received_heat_no: 'Heat number', received_mtc_no: 'MTC / certificate number',
  received_supplier_batch_no: 'Supplier batch number', received_serial_no: 'Serial number',
};
const REQUIRES_TO_RECEIVED = {
  requires_heat_no: 'received_heat_no', requires_mtc: 'received_mtc_no',
  requires_supplier_batch: 'received_supplier_batch_no', requires_serial_no: 'received_serial_no',
};

export default function ReceiveBomItemDialog({ item, onDone }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [receiptId, setReceiptId] = useState(null);
  const [qtyText, setQtyText] = useState(item.qty_text || '');
  const [receivedFields, setReceivedFields] = useState({});
  const [busy, setBusy] = useState(false);

  const requiredReceivedKeys = Object.entries(REQUIRES_TO_RECEIVED)
    .filter(([flag]) => item[flag])
    .map(([, field]) => field);

  async function submit(e) {
    e.preventDefault();
    if (!receiptId) return showToast('Choose or create a receipt', 'error');
    setBusy(true);
    try {
      // Multi-unit split, Phase 4 — this call may only be a PARTIAL receipt now (the line only
      // flips to Received once cumulative received qty meets what's required); the server tells us
      // which happened via fully_received, so the toast never overclaims completion.
      const res = await api(`/api/bom-items/${item.id}/receive`, {
        method: 'POST',
        body: { qty_text: qtyText, receipt: { existing_receipt_id: receiptId }, ...receivedFields },
      });
      showToast(res.fully_received
        ? 'Marked Received'
        : `Partial receipt recorded — ${res.received_so_far}${res.required_qty ? ` of ${res.required_qty}` : ''} received so far`);
      setOpen(false);
      router.refresh();
      onDone?.();
    } catch (err) { showToast(err.message, 'error'); }
    setBusy(false);
  }

  return (
    <>
      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setOpen(true)}>Receive</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Receive: {item.material_description}</DialogTitle></DialogHeader>
          <form onSubmit={submit} className="flex flex-col gap-3">
            {/* A fresh "New receipt" pick here writes invoice_no through the same POST /api/stock-receipts
                the create() call already uses — creating one directly against this BOM line's GRN would
                need a second create path with no real benefit, since this dialog just needs the id back. */}
            <ReceiptPicker value={receiptId} onChange={setReceiptId} requireInvoice />
            <div className="flex flex-col gap-1">
              <Label htmlFor="receive-qty">Quantity received</Label>
              <Input id="receive-qty" value={qtyText} onChange={e => setQtyText(e.target.value)} required />
            </div>
            {requiredReceivedKeys.map(field => (
              <div key={field} className="flex flex-col gap-1">
                <Label htmlFor={`receive-${field}`}>{RECEIVED_FIELD_LABELS[field]} *</Label>
                <Input id={`receive-${field}`} required
                  value={receivedFields[field] || ''}
                  onChange={e => setReceivedFields(prev => ({ ...prev, [field]: e.target.value }))} />
              </div>
            ))}
            <p className="text-xs text-muted-foreground">
              Enter what actually arrived — if it's less than the full required quantity, this is
              recorded as a partial receipt and the line stays open for the rest.
            </p>
            <DialogFooter>
              <Button type="submit" disabled={busy}>{busy ? 'Recording…' : 'Submit Receipt'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
