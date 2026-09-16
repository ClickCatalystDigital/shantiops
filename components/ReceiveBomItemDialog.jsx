'use client';

// components/ReceiveBomItemDialog.jsx — Feature A, the canonical Stores Receiving action's UI.
// Replaces free-text GRN editing for any BOM line that hasn't been received yet: a mandatory
// receipt (supplier/GRN/invoice, via ReceiptPicker) + the received quantity + whichever received_*
// fields the line's own requires_* flags demand. Submits to POST /api/bom-items/[id]/receive —
// the one place a Stores user can move a line into 'Received'.
//
// Unified delivery/lot-centric receiving, Phase 3d/2 — the quantity field defaults to the
// remaining outstanding amount (not the full original qty_text) with a visible running total. When
// this item's own PR was split across sibling projects (§Phase 0/3c), eligible siblings can be
// credited from this same physical delivery in one submission via the optional `splits` array.
//
// Routing decoupled from receiving (gentle-snuggling-wozniak.md, §5/§9) — receiving is now purely
// quantity + traceability. A childless line lands in Stores' Allocate queue once it's fully
// received; Production-vs-Dispatch is decided there, not here.
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, showToast } from '@/lib/client';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import ReceiptPicker from '@/components/ReceiptPicker';
import CertPicker from '@/components/CertPicker';

const RECEIVED_FIELD_LABELS = {
  received_heat_no: 'Heat number', received_mtc_no: 'MTC / certificate number',
  received_supplier_batch_no: 'Supplier batch number', received_serial_no: 'Serial number',
};
const REQUIRES_TO_RECEIVED = {
  requires_heat_no: 'received_heat_no', requires_mtc: 'received_mtc_no',
  requires_supplier_batch: 'received_supplier_batch_no', requires_serial_no: 'received_serial_no',
};

// The unit suffix a qty_text carries after its leading number ("10 Nos" -> "Nos") — reused to format
// a computed remaining/default quantity with the same units the line already uses.
function unitSuffix(qtyText) {
  return String(qtyText || '').replace(/^\s*[\d.]+\s*/, '').trim();
}

// A sibling recipient's own leading qty_text number — the honest default for how much of this
// delivery covers that project, before Stores overrides it.
function siblingDefaultQty(s) {
  return String(parseFloat((s.qty_text.match(/^\s*([\d.]+)/) || [])[1]) || 0);
}

export default function ReceiveBomItemDialog({ item, onDone }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [receiptId, setReceiptId] = useState(null);
  const [qtyText, setQtyText] = useState(item.qty_text || '');
  const [receivedFields, setReceivedFields] = useState({});
  const [busy, setBusy] = useState(false);
  // Phase 4 (QC statutory-forms plan) — MTC fulfillment is now a real linked test_certificates
  // record, not just a hand-typed string. Certificates are fetched lazily (only once this dialog
  // actually needs them) via the new project-scoped GET /api/test-certificates.
  const [certificates, setCertificates] = useState([]);
  const [testCertificateId, setTestCertificateId] = useState(null);
  const [certPickerOpen, setCertPickerOpen] = useState(false);

  // Phase 3d — required/received-so-far/planned siblings, fetched once on open.
  const [status, setStatus] = useState(null);
  const [selectedSiblings, setSelectedSiblings] = useState({}); // bom_item_id -> { qty }
  const [lotLabel, setLotLabel] = useState('');

  const requiredReceivedKeys = Object.entries(REQUIRES_TO_RECEIVED)
    .filter(([flag]) => item[flag])
    .map(([, field]) => field);

  useEffect(() => {
    if (!open) return;
    api(`/api/bom-items/${item.id}/receive`).then(d => {
      setStatus(d);
      const suffix = unitSuffix(item.qty_text);
      if (d.remaining != null) setQtyText(suffix ? `${d.remaining} ${suffix}` : String(d.remaining));
      // Unified delivery/lot-centric receiving, Phase 0/3b — a master/child PO line with more than
      // one declared lot needs Stores to say which physical delivery this is before the reference
      // applies; a single (or no) lot needs no field at all, silently defaulting to '1' server-side.
      const lots = d.planned_recipients?.kind === 'child' ? (d.planned_recipients.lots || []) : [];
      setLotLabel(lots.length === 1 ? lots[0] : '');
    }).catch(() => {});
  }, [open, item.id, item.qty_text]);

  useEffect(() => {
    if (!open || !item.requires_mtc) return;
    api(`/api/test-certificates?project_id=${item.project_id}`).then(setCertificates).catch(() => {});
  }, [open, item.requires_mtc, item.project_id]);

  async function pickCert(certId) {
    setTestCertificateId(certId);
    let cert = certificates.find(c => c.id === certId);
    if (!cert) {
      // Just created via CertPicker's own "+ Add certificate" escape hatch — not yet in our local
      // list (fetched once on open). Re-fetch so the display text/received_mtc_no reflect the real
      // new certificate instead of silently falling back to '' (which would then fail the server's
      // own missingTraceabilityFields check with a confusing "needs an MTC/certificate number").
      try {
        const fresh = await api(`/api/test-certificates?project_id=${item.project_id}`);
        setCertificates(fresh);
        cert = fresh.find(c => c.id === certId);
      } catch { /* best-effort */ }
    }
    setReceivedFields(prev => ({ ...prev, received_mtc_no: cert?.certificate_no || '' }));
  }

  function toggleSibling(s) {
    setSelectedSiblings(prev => {
      if (prev[s.bom_item_id]) {
        const next = { ...prev };
        delete next[s.bom_item_id];
        return next;
      }
      return { ...prev, [s.bom_item_id]: { qty: siblingDefaultQty(s) } };
    });
  }

  const siblings = status?.planned_recipients?.kind === 'sibling' ? status.planned_recipients.recipients : [];
  const lots = status?.planned_recipients?.kind === 'child' ? (status.planned_recipients.lots || []) : [];

  // Procurement already told us which sibling projects this PR line was split across, and how
  // much each expects — respect that by default instead of making Stores re-select every one by
  // hand. Fires once per dialog open (status only transitions null -> object once); the empty-prev
  // guard means a user who unchecks everything themselves is never overridden.
  useEffect(() => {
    if (!siblings.length) return;
    setSelectedSiblings(prev => (Object.keys(prev).length
      ? prev
      : Object.fromEntries(siblings.map(s => [s.bom_item_id, { qty: siblingDefaultQty(s) }]))));
  }, [status]);

  async function submit(e) {
    e.preventDefault();
    if (!receiptId) return showToast('Choose or create a receipt', 'error');
    if (item.requires_mtc && !testCertificateId) return showToast('Pick or add a test certificate first', 'error');
    if (lots.length > 1 && !lotLabel) return showToast('Pick which lot this delivery is', 'error');
    for (const sid of Object.keys(selectedSiblings)) {
      const s = selectedSiblings[sid];
      if (!(Number(s.qty) > 0)) return showToast('Enter a valid quantity for every selected sibling item', 'error');
    }
    setBusy(true);
    try {
      // Multi-unit split, Phase 4 — this call may only be a PARTIAL receipt now (the line only
      // flips to Received once cumulative received qty meets what's required); the server tells us
      // which happened via fully_received, so the toast never overclaims completion.
      const res = await api(`/api/bom-items/${item.id}/receive`, {
        method: 'POST',
        body: {
          qty_text: qtyText, receipt: { existing_receipt_id: receiptId },
          test_certificate_id: testCertificateId,
          lot_label: lotLabel || undefined,
          splits: Object.entries(selectedSiblings).map(([bomItemId, s]) => ({
            bom_item_id: Number(bomItemId), qty: Number(s.qty),
          })),
          ...receivedFields,
        },
      });
      showToast(res.fully_received
        ? 'Marked Received — held pending QC inward review'
        : `Partial receipt recorded — ${res.received_so_far}${res.required_qty ? ` of ${res.required_qty}` : ''} received so far, held pending QC review`);
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
        {/* This dialog nests several Selects (Receipt/Lot) — each one
            portals its popup to document.body, outside this DialogContent's own subtree, so
            Radix's DismissableLayer sees a click inside any of them as "outside the dialog" and
            closes it. Same fix as SheetContent's own guard in CertForm.jsx: ignore an outside
            pointer-down that actually landed in a Select popup. */}
        <DialogContent className="max-h-[85vh] overflow-y-auto"
          onPointerDownOutside={e => { if (e.target.closest('[data-slot="select-content"]')) e.preventDefault(); }}>
          <DialogHeader><DialogTitle>Receive: {item.material_description}</DialogTitle></DialogHeader>
          <form onSubmit={submit} className="flex flex-col gap-3">
            {(item.make || item.selected_supplier_name || item.po_ref) && (
              <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                {[item.make && `Make: ${item.make}`, item.selected_supplier_name && `Supplier: ${item.selected_supplier_name}`, item.po_ref && `PO: ${item.po_ref}`]
                  .filter(Boolean).join(' · ')}
              </div>
            )}
            {/* A fresh "New receipt" pick here writes invoice_no through the same POST /api/stock-receipts
                the create() call already uses — creating one directly against this BOM line's GRN would
                need a second create path with no real benefit, since this dialog just needs the id back. */}
            <ReceiptPicker value={receiptId} onChange={setReceiptId} requireInvoice />
            {lots.length > 1 && (
              <div className="flex flex-col gap-1">
                <Label>Which lot is this delivery? *</Label>
                <Select value={lotLabel} onValueChange={setLotLabel}>
                  <SelectTrigger><SelectValue placeholder="Pick a lot" /></SelectTrigger>
                  <SelectContent>
                    {lots.map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="flex flex-col gap-1">
              <Label htmlFor="receive-qty">Quantity received</Label>
              <Input id="receive-qty" value={qtyText} onChange={e => setQtyText(e.target.value)} required />
              {status?.required_qty ? (
                <p className="text-xs text-muted-foreground">
                  {status.received_so_far} of {status.required_qty} received so far
                </p>
              ) : null}
            </div>
            {requiredReceivedKeys.map(field => field === 'received_mtc_no' ? (
              <div key={field} className="flex flex-col gap-1">
                <Label>{RECEIVED_FIELD_LABELS[field]} *</Label>
                <Button type="button" variant="outline" className="justify-start font-normal" onClick={() => setCertPickerOpen(true)}>
                  {receivedFields.received_mtc_no || 'Pick or add a test certificate…'}
                </Button>
              </div>
            ) : (
              <div key={field} className="flex flex-col gap-1">
                <Label htmlFor={`receive-${field}`}>{RECEIVED_FIELD_LABELS[field]} *</Label>
                <Input id={`receive-${field}`} required
                  value={receivedFields[field] || ''}
                  onChange={e => setReceivedFields(prev => ({ ...prev, [field]: e.target.value }))} />
              </div>
            ))}
            {/* Heat number is always recordable, not just when Engineering flagged this line
                requires_heat_no — the backend (lib/bom-receiving.js) already accepts it
                unconditionally, this line just never rendered the field when it wasn't required.
                Matches AddPieceDialog's own precedent (heat number there is plain and optional). */}
            {!item.requires_heat_no && (
              <div className="flex flex-col gap-1">
                <Label htmlFor="receive-heat_no">Heat number (optional)</Label>
                <Input id="receive-heat_no"
                  value={receivedFields.received_heat_no || ''}
                  onChange={e => setReceivedFields(prev => ({ ...prev, received_heat_no: e.target.value }))} />
              </div>
            )}
            {siblings.length > 0 && (
              <div className="flex flex-col gap-2 rounded-md border border-dashed p-2">
                <p className="text-xs font-medium text-muted-foreground">
                  This delivery also covers (same purchase request, other projects):
                </p>
                {siblings.map(s => {
                  const sel = selectedSiblings[s.bom_item_id];
                  return (
                    <div key={s.bom_item_id} className="flex flex-col gap-1.5">
                      <label className="flex items-center gap-2 text-sm">
                        <Checkbox checked={!!sel} onCheckedChange={() => toggleSibling(s)} />
                        {s.project_no} — {s.qty_text}
                      </label>
                      {sel && (
                        <div className="ml-6 flex flex-wrap items-center gap-2">
                          <Input className="h-7 w-28 text-xs" type="number" min="0" step="0.01"
                            value={sel.qty}
                            onChange={e => setSelectedSiblings(prev => ({ ...prev, [s.bom_item_id]: { ...prev[s.bom_item_id], qty: e.target.value } }))}
                            placeholder="Qty" />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
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
      <CertPicker open={certPickerOpen} onOpenChange={setCertPickerOpen} title="Link test certificate"
        certificates={certificates} project={{ id: item.project_id }} onPick={pickCert} />
    </>
  );
}
