'use client';

// V2-CHANGES.md Phase 5.1 — Create RFQ, from Enquiry's bulk selection: confirm items -> pick
// suppliers (searchable multi-select over the real 445-row Group 3 import) -> in-system draft
// preview (D13: recipients + composed message + item list + each supplier's portal link) ->
// WhatsApp wa.me click-send, or Email sent from the app through the company's Procurement mailbox
// (Settings → Procurement · Email; test mode keeps it from reaching the supplier).
import { useState } from 'react';
import { api, showToast, sendWhatsApp } from '@/lib/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Badge } from './ui/badge';
import { COMPANY_NAMES, defaultCompany } from '@/lib/company-profiles';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';

// India-only assumption (this business), same as the enroll-code precedent elsewhere in the app —
// a 10-digit local number gets the country code prefixed; anything else (already has one, or a
// landline with an STD code) is passed through as typed.
function waDigits(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return null;
  return digits.length === 10 ? `91${digits}` : digits;
}

function composeMessage({ rfqNo, supplierName, items, portalUrl, company = defaultCompany() }) {
  // Gap #2 (2026-09-04) — items already carry qty_breakdown (getSourcingItems(), §5be); this
  // composer just never read it, so a supplier quoting a multiplied line saw the raw per-unit
  // figure ("Qty 2 Mtrs") with no sense of the real total order size.
  const itemLines = items.map((it, i) =>
    `${i + 1}. ${it.material_description} — Qty ${it.qty_text || '—'}${it.qty_breakdown ? ` (${it.qty_breakdown.label})` : ''}`
  ).join('\n');
  return `RFQ ${rfqNo} — ${company}

Dear ${supplierName},

Request for quotation. Please submit your rates for the items below through your private link (no login needed):
${portalUrl}

Items:
${itemLines}

The link is valid for 14 days. Kindly include unit price, payment terms, and expected delivery.

Regards,
Procurement — ${company}`;
}

function SupplierDraftCard({ supplier, rfqId, rfqNo, company, items, onMarkSent, onEmailed, onRemove }) {
  const portalUrl = `${window.location.origin}/rfq/${supplier.token}`;
  const message = composeMessage({ rfqNo, supplierName: supplier.supplier_name, items, portalUrl, company });
  const digits = waDigits(supplier.phone);
  const [compose, setCompose] = useState(null); // { to, subject, body } while the email form is open
  const [sending, setSending] = useState(false);

  async function sendEmail() {
    setSending(true);
    try {
      const r = await api(`/api/rfqs/${rfqId}/send-email`, { method: 'POST', body: { supplier_id: supplier.supplier_id, ...compose } });
      if (r.live) { showToast(`Emailed ${compose.to}`); onEmailed(supplier.supplier_id); }
      else showToast(r.note);
      setCompose(null);
    } catch (err) { showToast(err.message, 'error'); }
    setSending(false);
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4 text-sm">
      <div className="flex items-center justify-between">
        <span className="font-medium">{supplier.supplier_name}</span>
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          {supplier.phone || 'no phone'} · {supplier.email || 'no email'}
          {supplier.responded_at
            ? <Badge variant="outline" className="text-success">Quoted</Badge>
            : onRemove && <button type="button" className="text-destructive hover:underline" onClick={() => onRemove(supplier.supplier_id)}>Remove</button>}
        </span>
      </div>
      <details className="group rounded-md bg-muted/30 text-xs text-muted-foreground">
        <summary className="cursor-pointer select-none px-3 py-1.5 hover:text-foreground">Message preview</summary>
        <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap px-3 pb-3">{message}</pre>
      </details>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={!digits}
          onClick={() => sendWhatsApp(`/api/rfqs/${rfqId}/send-whatsapp`, { supplier_id: supplier.supplier_id, text: message, link: portalUrl },
            `https://wa.me/${digits}?text=${encodeURIComponent(message)}`).then(() => onMarkSent(supplier.supplier_id))}>
          {digits ? 'WhatsApp' : 'WhatsApp (no phone)'}
        </Button>
        <Button size="sm" variant="outline" disabled={!!compose}
          onClick={() => setCompose({ to: supplier.email || '', subject: `RFQ ${rfqNo} — ${company}`, body: message })}>
          Email
        </Button>
        <Button size="sm" variant="ghost" onClick={() => { navigator.clipboard.writeText(portalUrl); showToast('Link copied'); }}>
          Copy link
        </Button>
        {supplier.sent_at && <Badge variant="outline" className="ml-auto text-muted-foreground">Sent</Badge>}
      </div>
      {compose && (
        <div className="flex flex-col gap-2 rounded-md border bg-muted/20 p-3">
          <Input value={compose.to} onChange={e => setCompose(c => ({ ...c, to: e.target.value }))} placeholder="Supplier email" />
          <Input value={compose.subject} onChange={e => setCompose(c => ({ ...c, subject: e.target.value }))} />
          <Textarea rows={8} value={compose.body} onChange={e => setCompose(c => ({ ...c, body: e.target.value }))} />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setCompose(null)} disabled={sending}>Cancel</Button>
            <Button size="sm" onClick={sendEmail} disabled={sending || !compose.to.trim()}>{sending ? 'Sending…' : 'Send email'}</Button>
          </div>
        </div>
      )}
    </div>
  );
}

// `existingRfq` (full GET /api/rfqs/[id] detail) opens an already-created RFQ for editing: send links
// again, add suppliers, remove a supplier who hasn't quoted, remove an item.
export default function CreateRfqDialog({ items, suppliers, router, onClose, onCreated, existingRfq }) {
  const [step, setStep] = useState(existingRfq ? 'preview' : 'suppliers'); // suppliers -> preview
  const [supplierSearch, setSupplierSearch] = useState('');
  const [selectedSupplierIds, setSelectedSupplierIds] = useState(new Set());
  const [busy, setBusy] = useState(false);
  const [rfq, setRfq] = useState(existingRfq || null);
  const adding = !!rfq; // suppliers step reached from an existing RFQ = add suppliers to it
  const listItems = rfq ? rfq.items.map(it => ({ ...it, id: it.bom_item_id })) : items;
  // No item has a real project: whose RFQ this is (letterhead, mailbox, message) is picked here.
  // With a project, that project's company is used and this isn't shown.
  const noProject = rfq ? !rfq.has_project : items.every(it => it.project_is_system);
  const [company, setCompany] = useState(defaultCompany());
  const companyPicker = (value, onChange) => noProject && COMPANY_NAMES.length > 1 && (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-muted-foreground">Company (no project selected)</span>
      <Select value={value} onValueChange={onChange} disabled={busy}>
        <SelectTrigger className="h-8 w-56"><SelectValue /></SelectTrigger>
        <SelectContent>{COMPANY_NAMES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
      </Select>
    </div>
  );

  const needle = supplierSearch.trim().toLowerCase();
  const invited = new Set((rfq?.suppliers || []).map(s => s.supplier_id));
  const shownSuppliers = suppliers.filter(s => !invited.has(s.id) && (!needle || s.name.toLowerCase().includes(needle)));

  async function edit(body, msg) {
    setBusy(true);
    try { setRfq(await api(`/api/rfqs/${rfq.id}`, { method: 'PATCH', body })); if (msg) showToast(msg); return true; }
    catch (err) { showToast(err.message, 'error'); return false; }
    finally { setBusy(false); }
  }
  async function addSuppliers() {
    if (!selectedSupplierIds.size) return showToast('Pick at least one supplier', 'error');
    if (await edit({ action: 'add_suppliers', supplier_ids: [...selectedSupplierIds] }, 'Suppliers added')) {
      setSelectedSupplierIds(new Set()); setStep('preview');
    }
  }
  function removeSupplier(id) {
    if (confirm('Remove this supplier from the RFQ? Their link will stop working.')) edit({ action: 'remove_supplier', supplier_id: id }, 'Supplier removed');
  }
  function removeItem(id) {
    if (confirm('Remove this item from the RFQ? Quotes already received for it are kept.')) edit({ action: 'remove_item', bom_item_id: id }, 'Item removed');
  }

  function toggleSupplier(id) {
    setSelectedSupplierIds(s => { const next = new Set(s); next.has(id) ? next.delete(id) : next.add(id); return next; });
  }

  async function create() {
    if (!selectedSupplierIds.size) return showToast('Pick at least one supplier', 'error');
    setBusy(true);
    try {
      const detail = await api('/api/rfqs', {
        method: 'POST',
        body: { bom_item_ids: items.map(it => it.id), supplier_ids: [...selectedSupplierIds], company: noProject ? company : undefined },
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
    <Dialog open onOpenChange={o => { if (!o) (rfq ? onCreated() : onClose()); }}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-4xl">
        {step === 'suppliers' && (
          <>
            <DialogHeader>
              <DialogTitle>{adding ? `${rfq.rfq_no} — add suppliers` : `Create RFQ — ${items.length} item${items.length !== 1 ? 's' : ''}`}</DialogTitle>
            </DialogHeader>
            <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
              <div className="flex flex-col gap-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Items</p>
                <ul className="max-h-80 divide-y overflow-y-auto rounded-lg border bg-muted/20 text-sm">
                  {listItems.map(it => (
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
            {!adding && companyPicker(company, setCompany)}
            <DialogFooter className="items-center sm:justify-between">
              <span className="text-xs text-muted-foreground">{selectedSupplierIds.size} supplier{selectedSupplierIds.size === 1 ? '' : 's'} selected</span>
              <div className="flex gap-2">
              <Button variant="outline" onClick={adding ? () => setStep('preview') : onClose}>{adding ? 'Back' : 'Cancel'}</Button>
              {adding
                ? <Button disabled={busy} onClick={addSuppliers}>{busy ? 'Adding…' : 'Add suppliers'}</Button>
                : <Button disabled={busy} onClick={create}>{busy ? 'Creating…' : 'Create RFQ'}</Button>}
              </div>
            </DialogFooter>
          </>
        )}
        {step === 'preview' && rfq && (
          <>
            <DialogHeader>
              <DialogTitle>{rfq.rfq_no} — review & send</DialogTitle>
            </DialogHeader>
            {companyPicker(rfq.company, c => edit({ action: 'set_company', company: c }, 'Company changed'))}
            <ul className="divide-y rounded-lg border bg-muted/20 text-sm">
              {rfq.items.map(it => (
                <li key={it.bom_item_id} className="flex items-center justify-between gap-2 px-3 py-1.5">
                  <span className="min-w-0">{it.material_description}{it.qty_text ? ` — ${it.qty_text}` : ''}</span>
                  {rfq.items.length > 1 && (
                    <button type="button" disabled={busy} className="shrink-0 text-xs text-destructive hover:underline" onClick={() => removeItem(it.bom_item_id)}>Remove</button>
                  )}
                </li>
              ))}
            </ul>
            <div className="grid gap-3 md:grid-cols-2">
              {rfq.suppliers.map(s => (
                <SupplierDraftCard key={s.id} supplier={s} rfqId={rfq.id} rfqNo={rfq.rfq_no} company={rfq.company} items={rfq.items} onMarkSent={markSent}
                  onRemove={rfq.suppliers.length > 1 ? removeSupplier : null}
                  onEmailed={id => setRfq(r => ({ ...r, suppliers: r.suppliers.map(x => x.supplier_id === id ? { ...x, sent_at: new Date().toISOString() } : x) }))} />
              ))}
            </div>
            <DialogFooter className="items-center sm:justify-between">
              <Button variant="outline" disabled={busy} onClick={() => setStep('suppliers')}>+ Add suppliers</Button>
              <Button onClick={onCreated}>Done</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
