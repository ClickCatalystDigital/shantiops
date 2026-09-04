'use client';

// V2-CHANGES.md Phase 5.1 — the supplier's own quote-entry form, posted to the public
// app/api/rfq/[token]/route.js. One submission per RFQ (append-only precedent, same as the
// authenticated Add-quote flow — a correction goes through Procurement, not a self-edit here).
import { useState } from 'react';
import { api, showToast } from '@/lib/client';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
import PaymentTermsField from './PaymentTermsField';

function emptyLine() {
  return { unit_price: '', uom: '', payment_terms: '', advance_pct: '', expected_delivery_date: '', remarks: '' };
}

export default function RfqPortalForm({ token, rfq, alreadyResponded }) {
  const [lines, setLines] = useState(() => Object.fromEntries(rfq.items.map(it => [it.rfq_item_id, emptyLine()])));
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(alreadyResponded);

  function setLine(id, patch) {
    setLines(l => ({ ...l, [id]: { ...l[id], ...patch } }));
  }

  async function submit() {
    const priced = rfq.items.filter(it => Number(lines[it.rfq_item_id]?.unit_price) > 0);
    if (!priced.length) return showToast('Enter at least one price', 'error');
    setBusy(true);
    try {
      await api(`/api/rfq/${token}`, {
        method: 'POST',
        body: {
          lines: priced.map(it => {
            const l = lines[it.rfq_item_id];
            const paymentTerms = l.payment_terms === 'Advance %' && l.advance_pct ? `Advance ${l.advance_pct}` : l.payment_terms;
            return {
              rfq_item_id: it.rfq_item_id, unit_price: Number(l.unit_price), uom: l.uom || undefined,
              payment_terms: paymentTerms || undefined, expected_delivery_date: l.expected_delivery_date || undefined,
              remarks: l.remarks || undefined,
            };
          }),
        },
      });
      setDone(true);
    } catch (err) { showToast(err.message, 'error'); }
    setBusy(false);
  }

  if (done) {
    return (
      <div className="rounded-md border bg-muted/30 p-6 text-center">
        <p className="font-medium">Thanks — your quote has been submitted.</p>
        <p className="mt-1 text-sm text-muted-foreground">Procurement will be in touch. You can close this page.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {rfq.items.map(it => (
        <div key={it.rfq_item_id} className="flex flex-col gap-3 rounded-md border p-3">
          <p className="text-sm font-medium">{it.material_description}</p>
          <p className="text-xs text-muted-foreground">
            {it.moc || '—'} · {it.size_spec || '—'} · Qty {it.qty_text || '—'}
            {it.qty_breakdown && ` (${it.qty_breakdown.label})`}
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Unit price</Label>
              <Input type="number" min="0" step="0.01" value={lines[it.rfq_item_id].unit_price}
                onChange={e => setLine(it.rfq_item_id, { unit_price: e.target.value })} placeholder="Rate" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>UoM</Label>
              <Input value={lines[it.rfq_item_id].uom} onChange={e => setLine(it.rfq_item_id, { uom: e.target.value })} placeholder="e.g. Kg, No" />
            </div>
          </div>
          <PaymentTermsField value={lines[it.rfq_item_id].payment_terms} advancePct={lines[it.rfq_item_id].advance_pct}
            onChange={v => setLine(it.rfq_item_id, { payment_terms: v })} onAdvancePctChange={v => setLine(it.rfq_item_id, { advance_pct: v })} />
          <div className="flex flex-col gap-1.5">
            <Label>Expected delivery</Label>
            <Input type="date" value={lines[it.rfq_item_id].expected_delivery_date}
              onChange={e => setLine(it.rfq_item_id, { expected_delivery_date: e.target.value })} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Remarks</Label>
            <Textarea value={lines[it.rfq_item_id].remarks} onChange={e => setLine(it.rfq_item_id, { remarks: e.target.value })} rows={2} />
          </div>
        </div>
      ))}
      <Button disabled={busy} onClick={submit}>{busy ? 'Submitting…' : 'Submit quote'}</Button>
    </div>
  );
}
