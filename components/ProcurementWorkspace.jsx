'use client';

// Procurement's cross-project workbench (§5a), rebuilt into the four-tab flow from
// PROCUREMENT-CHANGES.md §4: Sourcing (gather quotes) -> Selection (compare/pick, auto-drafts a PO)
// -> Purchase Orders (issue/cancel-issue) -> Status (search + manual status override, always shows
// every accepted item regardless of stage — labeled "State" in the original spec, renamed for
// clarity in the Phase 4 polish pass). Suppliers stays a 5th tab, visually separated to the right of
// the other four (it's a standalone feature, not part of their shared lifecycle) — not named in the
// redesign spec, but it's a real, working feature (add/edit/deactivate) with no other home, so it's
// kept rather than dropped. One shared search input lives under the tab bar, same position
// regardless of active tab, filtering whichever tab is open.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, showToast, formatDate, formatMoney } from '@/lib/client';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './ui/tabs';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Label } from './ui/label';
import { Badge } from './ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog';
import { Sheet, SheetContent, SheetHeader, SheetFooter, SheetTitle, SheetDescription } from './ui/sheet';

const PAYMENT_TERM_PRESETS = ['LC', 'Advance %', 'After Delivery', 'PDC', 'COD'];
const ADVANCE_PCTS = Array.from({ length: 10 }, (_, i) => `${(i + 1) * 10}%`);
const RESOLVED = ['CLOSED', 'RECEIVED', 'CANCELLED'];
// Sourcing/Selection are for items still working toward a PO — once one's issued (TRANSIT) or
// closed out, it's State's job to show it, not theirs.
const OUT_OF_PIPELINE = [...RESOLVED, 'TRANSIT'];
const STATUS_TONE = {
  PENDING: 'bg-muted text-muted-foreground ring-border',
  TRANSIT: 'bg-warning/10 text-warning ring-warning/20',
  CLOSED: 'bg-success/10 text-success ring-success/20',
  RECEIVED: 'bg-success/10 text-success ring-success/20',
  CANCELLED: 'bg-danger/10 text-danger ring-danger/20',
};
const BOM_STATUSES = ['PENDING', 'TRANSIT', 'CLOSED', 'CANCELLED', 'RECEIVED'];

// Payment terms field — LC / Advance % (reveals a 10-100% step-10 picker) / After Delivery / PDC /
// COD, plus a free-text "add new option" escape hatch (§4.1). Shared by Sourcing's quote form.
function PaymentTermsField({ value, advancePct, onChange, onAdvancePctChange }) {
  const [custom, setCustom] = useState(!PAYMENT_TERM_PRESETS.includes(value) && !!value);
  return (
    <div className="flex flex-col gap-1.5">
      <Label>Payment terms</Label>
      {custom ? (
        <Input value={value} onChange={e => onChange(e.target.value)} placeholder="Custom terms" autoFocus />
      ) : (
        <Select value={value} onValueChange={v => onChange(v)}>
          <SelectTrigger className="w-full"><SelectValue placeholder="—" /></SelectTrigger>
          <SelectContent>{PAYMENT_TERM_PRESETS.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
        </Select>
      )}
      {value === 'Advance %' && !custom && (
        <Select value={advancePct} onValueChange={onAdvancePctChange}>
          <SelectTrigger className="h-8 w-full text-xs"><SelectValue placeholder="Which %?" /></SelectTrigger>
          <SelectContent>{ADVANCE_PCTS.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
        </Select>
      )}
      <button type="button" className="w-fit text-xs text-primary hover:underline"
        onClick={() => { setCustom(c => !c); onChange(''); }}>
        {custom ? 'Pick from list' : '+ Add new option'}
      </button>
    </div>
  );
}

function ItemContext({ it }) {
  return (
    <p className="truncate text-xs text-muted-foreground">
      {it.project_no} · {it.moc || '—'} · {it.size_spec || '—'} · {it.qty_text || '—'}
      {it.pr_ref && ` · PR ${it.pr_ref}`}
    </p>
  );
}

// ---------- Sourcing ----------

function AddQuoteDialog({ item, suppliers, router, onClose }) {
  const [supplierId, setSupplierId] = useState('');
  const [newSupplier, setNewSupplier] = useState(false);
  const [newSupplierName, setNewSupplierName] = useState('');
  const [price, setPrice] = useState('');
  const [uom, setUom] = useState('');
  const [terms, setTerms] = useState('');
  const [advancePct, setAdvancePct] = useState('');
  const [deliveryDate, setDeliveryDate] = useState('');
  const [source, setSource] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!newSupplier && !supplierId) return showToast('Pick a supplier', 'error');
    if (newSupplier && !newSupplierName.trim()) return showToast('Name the new supplier', 'error');
    if (!(Number(price) > 0)) return showToast('Enter a price', 'error');
    setBusy(true);
    try {
      let sid = supplierId;
      if (newSupplier) {
        const res = await api('/api/suppliers', { method: 'POST', body: { name: newSupplierName.trim() } });
        sid = res.id;
      }
      const paymentTerms = terms === 'Advance %' && advancePct ? `Advance ${advancePct}` : terms;
      await api('/api/supplier-quotes', {
        method: 'POST',
        body: {
          supplier_id: sid,
          items: [{ bom_item_id: item.id, unit_price: Number(price), uom: uom || undefined }],
          payment_terms: paymentTerms || undefined, quote_source: source || undefined,
          expected_delivery_date: deliveryDate || undefined,
        },
      });
      showToast('Quote logged'); router.refresh(); onClose();
    } catch (err) { showToast(err.message, 'error'); }
    setBusy(false);
  }

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
        <DialogHeader><DialogTitle>Add quote — {item.material_description}</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>Vendor / Make</Label>
            {newSupplier ? (
              <Input value={newSupplierName} onChange={e => setNewSupplierName(e.target.value)} placeholder="New supplier name" autoFocus />
            ) : (
              <Select value={supplierId} onValueChange={setSupplierId}>
                <SelectTrigger className="w-full"><SelectValue placeholder="Choose…" /></SelectTrigger>
                <SelectContent>{suppliers.map(s => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}</SelectContent>
              </Select>
            )}
            <button type="button" className="w-fit text-xs text-primary hover:underline" onClick={() => setNewSupplier(v => !v)}>
              {newSupplier ? 'Pick existing supplier' : '+ Add a new supplier'}
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Quote</Label>
              <Input type="number" min="0" step="0.01" value={price} onChange={e => setPrice(e.target.value)} placeholder="Unit price" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>UoM</Label>
              <Input value={uom} onChange={e => setUom(e.target.value)} placeholder="e.g. Kg, No" />
            </div>
          </div>
          <PaymentTermsField value={terms} advancePct={advancePct} onChange={setTerms} onAdvancePctChange={setAdvancePct} />
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Expected delivery</Label>
              <Input type="date" value={deliveryDate} onChange={e => setDeliveryDate(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Quote source</Label>
              <Select value={source} onValueChange={setSource}>
                <SelectTrigger className="w-full"><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="whatsapp">WhatsApp</SelectItem>
                  <SelectItem value="email">Email</SelectItem>
                  <SelectItem value="phone">Phone</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button disabled={busy} onClick={submit}>{busy ? 'Saving…' : 'Add quote'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SourcingRow({ it, quotes, suppliers, router }) {
  const [expanded, setExpanded] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <div className="border-b last:border-b-0">
      <button className="flex w-full items-center gap-3 py-2.5 text-left text-sm" onClick={() => setExpanded(v => !v)}>
        <div className="min-w-0 flex-1">
          <span className="font-medium">{it.material_description}</span>
          <ItemContext it={it} />
        </div>
        {quotes.length > 0 && <Badge variant="outline">{quotes.length} quote{quotes.length !== 1 ? 's' : ''}</Badge>}
      </button>
      {expanded && (
        <div className="flex flex-col gap-2 bg-muted/30 px-3 py-3 text-sm">
          {quotes.length === 0 && <p className="text-xs text-muted-foreground">No quotes yet.</p>}
          {quotes.map(q => (
            <div key={q.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-background px-3 py-1.5">
              <span className="font-medium">{q.supplier_name}</span>
              <span className="text-xs text-muted-foreground">
                {formatMoney(q.unit_price)}{q.uom ? `/${q.uom}` : ''}
                {q.payment_terms ? ` · ${q.payment_terms}` : ''}
                {q.expected_delivery_date ? ` · by ${formatDate(q.expected_delivery_date)}` : ''}
              </span>
            </div>
          ))}
          <Button size="sm" variant="outline" className="w-fit" onClick={() => setDialogOpen(true)}>+ Add quote</Button>
        </div>
      )}
      {dialogOpen && (
        <AddQuoteDialog item={it} suppliers={suppliers} router={router} onClose={() => setDialogOpen(false)} />
      )}
    </div>
  );
}

function Sourcing({ items, quotesByItem, suppliers, router, q }) {
  const needle = q.trim().toLowerCase();
  const shown = items.filter(it => !it.selected_quote_id && !OUT_OF_PIPELINE.includes(it.purchase_status))
    .filter(it => !needle || it.material_description.toLowerCase().includes(needle) || it.project_no.toLowerCase().includes(needle));

  return (
    <Card>
      <CardContent className="flex flex-col pt-4">
        {shown.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">Nothing to source right now.</p>}
        {shown.map(it => (
          <SourcingRow key={it.id} it={it} quotes={quotesByItem[it.id] || []} suppliers={suppliers} router={router} />
        ))}
      </CardContent>
    </Card>
  );
}

// ---------- Selection ----------

function SelectionRow({ it, quotes, router }) {
  const [busy, setBusy] = useState(false);
  const lowestPrice = quotes.length ? Math.min(...quotes.map(q => q.unit_price)) : null;
  const fastest = quotes.filter(q => q.expected_delivery_date).length
    ? Math.min(...quotes.filter(q => q.expected_delivery_date).map(q => new Date(q.expected_delivery_date).getTime()))
    : null;

  async function select(quoteId) {
    setBusy(true);
    try {
      await api(`/api/bom-items/${it.id}/select-supplier`, { method: 'POST', body: { quote_id: quoteId } });
      showToast('Supplier selected — PO draft updated'); router.refresh();
    } catch (err) { showToast(err.message, 'error'); }
    setBusy(false);
  }
  async function undo() {
    setBusy(true);
    try {
      await api(`/api/bom-items/${it.id}/select-supplier`, { method: 'DELETE' });
      showToast('Selection undone'); router.refresh();
    } catch (err) { showToast(err.message, 'error'); }
    setBusy(false);
  }

  return (
    <div className="flex flex-col gap-2 border-b py-3 last:border-b-0">
      <div className="flex items-center justify-between">
        <div className="min-w-0">
          <p className="font-medium">{it.material_description}</p>
          <ItemContext it={it} />
        </div>
        {it.selected_quote_id && (
          <Button size="sm" variant="outline" disabled={busy} onClick={undo}>Undo selection</Button>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        {quotes.map(q => (
          <div key={q.id}
            className={`flex flex-wrap items-center gap-2 rounded-md border px-3 py-1.5 text-sm ${q.id === it.selected_quote_id ? 'border-foreground/30 bg-muted' : ''}`}>
            <span className="font-medium">{q.supplier_name}</span>
            <span className="text-xs text-muted-foreground">{formatMoney(q.unit_price)}{q.uom ? `/${q.uom}` : ''}</span>
            {q.unit_price === lowestPrice && <Badge variant="outline" className="text-success">Lowest price</Badge>}
            {fastest && q.expected_delivery_date && new Date(q.expected_delivery_date).getTime() === fastest && (
              <Badge variant="outline" className="text-primary">Fastest delivery</Badge>
            )}
            {q.payment_terms && <span className="text-xs text-muted-foreground">{q.payment_terms}</span>}
            {q.expected_delivery_date && <span className="text-xs text-muted-foreground">by {formatDate(q.expected_delivery_date)}</span>}
            <div className="ml-auto">
              {q.id === it.selected_quote_id
                ? <Badge>Selected</Badge>
                : <Button size="sm" variant="ghost" disabled={busy} onClick={() => select(q.id)}>Select</Button>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Selection({ items, quotesByItem, router, q }) {
  const needle = q.trim().toLowerCase();
  const shown = items.filter(it => (quotesByItem[it.id] || []).length > 0 && !OUT_OF_PIPELINE.includes(it.purchase_status))
    .filter(it => !needle || it.material_description.toLowerCase().includes(needle) || it.project_no.toLowerCase().includes(needle));
  return (
    <Card>
      <CardContent className="flex flex-col pt-4">
        {shown.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">Nothing ready to compare yet — log a quote in Sourcing first.</p>}
        {shown.map(it => <SelectionRow key={it.id} it={it} quotes={quotesByItem[it.id] || []} router={router} />)}
      </CardContent>
    </Card>
  );
}

// ---------- Purchase orders ----------

const PO_TONE = {
  draft: 'bg-muted text-muted-foreground',
  issued: 'bg-warning/10 text-warning ring-1 ring-inset ring-warning/20',
  cancelled: 'bg-danger/10 text-danger ring-1 ring-inset ring-danger/20',
};

// The PO detail drawer — View no longer opens a new browser tab; it slides in from the right with
// the PDF rendered inline (the route already serves Content-Disposition: inline, same as the
// packing PDF route, so the iframe just works) and every action lives in the footer here instead of
// crowding the row. Reuses whatever handler/busy state the parent (PurchaseOrders) passes down —
// no duplicated logic, just relocated.
function PODrawer({ po, onClose, onIssue, onUnissue, onCancel, busy }) {
  return (
    <Sheet open onOpenChange={o => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>{po.po_no}</SheetTitle>
          <SheetDescription>
            {po.supplier_name} · {po.item_count} item{po.item_count !== 1 ? 's' : ''} · {formatMoney(po.subtotal)}
            {' · '}
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${PO_TONE[po.status] || ''}`}>{po.status}</span>
          </SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 px-4">
          <iframe src={`/api/purchase-orders/${po.id}/pdf`} title={`${po.po_no} PDF`} className="h-full w-full rounded-md border" />
        </div>
        <SheetFooter className="flex-row gap-2">
          {po.status === 'draft' && (
            <Button className="flex-1" disabled={busy} onClick={() => onIssue(po)}>{busy ? 'Issuing…' : 'Issue'}</Button>
          )}
          {po.status === 'issued' && (
            <Button variant="outline" className="flex-1" disabled={busy} onClick={() => onUnissue(po)}>Cancel Issue</Button>
          )}
          {po.status !== 'cancelled' && (
            <Button variant="ghost" className="text-destructive hover:text-destructive" disabled={busy} onClick={() => onCancel(po)}>Cancel PO</Button>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function PurchaseOrders({ orders, q, view }) {
  const router = useRouter();
  const [busy, setBusy] = useState(null);
  const [viewingId, setViewingId] = useState(null);
  const needle = q.trim().toLowerCase();
  // Active vs Fulfilled (§ Phase 4) — a fulfilled PO (every line resolved, or the PO itself
  // cancelled) has nothing left to act on, so it drops out of the default list rather than
  // accumulating there forever; the toggle in the shared search row switches which bucket shows.
  const bucketed = orders.filter(po => (view === 'fulfilled' ? po.fulfilled : !po.fulfilled));
  const shown = bucketed.filter(po => !needle
    || po.po_no.toLowerCase().includes(needle) || po.supplier_name.toLowerCase().includes(needle));
  const viewing = orders.find(po => po.id === viewingId) || null;

  // Issuing still needs to hand the PM a real file (not just leave the drawer open) — fetch the same
  // PDF route as a blob and trigger a download, instead of the old window.open(..., '_blank').
  async function issue(po) {
    setBusy(po.id);
    try {
      await api(`/api/purchase-orders/${po.id}`, { method: 'PATCH', body: { action: 'issue' } });
      const res = await fetch(`/api/purchase-orders/${po.id}/pdf`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `${po.po_no.replace(/\//g, '-')}.pdf`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      showToast(`${po.po_no} issued`); router.refresh();
    } catch (err) { showToast(err.message, 'error'); }
    setBusy(null);
  }
  async function unissue(po) {
    setBusy(po.id);
    try {
      await api(`/api/purchase-orders/${po.id}`, { method: 'PATCH', body: { action: 'unissue' } });
      showToast(`${po.po_no} back to draft`); router.refresh();
    } catch (err) { showToast(err.message, 'error'); }
    setBusy(null);
  }
  async function cancel(po) {
    const reason = window.prompt(`Cancel ${po.po_no} — why?`);
    if (reason === null) return;
    setBusy(po.id);
    try {
      await api(`/api/purchase-orders/${po.id}`, { method: 'PATCH', body: { action: 'cancel', reason } });
      showToast(`${po.po_no} cancelled`); setViewingId(null); router.refresh();
    } catch (err) { showToast(err.message, 'error'); }
    setBusy(null);
  }

  if (!orders.length) return <p className="py-10 text-center text-sm text-muted-foreground">No purchase orders yet — select a supplier for an item in Selection to start one.</p>;

  return (
    <Card>
      {shown.length > 0 && (
        <div className="flex items-center gap-3 border-b px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <span className="flex-1">PO No. · Supplier</span>
          <span className="w-20 shrink-0">Status</span>
          <span className="w-32 shrink-0">Items · Total</span>
          <span className="w-20 shrink-0 text-right">Date</span>
        </div>
      )}
      <CardContent className="flex flex-col divide-y pt-4">
        {shown.length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {bucketed.length === 0
              ? `No ${view} purchase orders.`
              : 'No purchase orders match.'}
          </p>
        )}
        {shown.map(po => (
          <button key={po.id} onClick={() => setViewingId(po.id)}
            className="flex flex-wrap items-center gap-3 py-2.5 text-left text-sm transition-colors hover:bg-muted/40 -mx-2 px-2 rounded">
            <span className="flex-1 truncate">
              <span className="font-medium">{po.po_no}</span>
              <span className="text-muted-foreground"> · {po.supplier_name}</span>
            </span>
            <span className={`w-20 shrink-0 rounded-full px-2 py-0.5 text-center text-xs font-medium ${PO_TONE[po.status] || ''}`}>{po.status}</span>
            <span className="w-32 shrink-0 text-xs text-muted-foreground">{po.item_count} item{po.item_count !== 1 ? 's' : ''} · {formatMoney(po.subtotal)}</span>
            <span className="w-20 shrink-0 text-right text-xs text-muted-foreground">{formatDate(po.created_at)}</span>
          </button>
        ))}
      </CardContent>
      {viewing && (
        <PODrawer po={viewing} onClose={() => setViewingId(null)}
          onIssue={issue} onUnissue={unissue} onCancel={cancel} busy={busy === viewing.id} />
      )}
    </Card>
  );
}

// ---------- State ----------

function State({ items, router, q, statusFilter }) {
  const [busy, setBusy] = useState(null);
  const needle = q.trim().toLowerCase();
  const shown = items.filter(it => !needle
    || it.material_description.toLowerCase().includes(needle)
    || it.project_no.toLowerCase().includes(needle)
    || (it.po_ref || '').toLowerCase().includes(needle))
    .filter(it => statusFilter === 'all' || (it.purchase_status || 'PENDING') === statusFilter);

  async function setStatus(it, value) {
    setBusy(it.id);
    try {
      await api(`/api/bom-items/${it.id}`, { method: 'PATCH', body: { purchase_status: value } });
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); }
    setBusy(null);
  }

  return (
    <Card>
      {shown.length > 0 && (
        <div className="flex items-center gap-3 border-b px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <span className="flex-1">Part Description</span>
          <span className="w-28 shrink-0">PO No.</span>
          <span className="w-32 shrink-0">Make</span>
          <span className="w-28 shrink-0">Status</span>
        </div>
      )}
      <CardContent className="flex flex-col divide-y pt-4">
        {shown.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">No items match.</p>}
        {shown.map(it => (
            <div key={it.id} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{it.material_description}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {it.project_no} · {it.moc || '—'} · {it.size_spec || '—'} · {it.qty_text || '—'}
                  {it.pr_ref && ` · PR ${it.pr_ref}`}
                </p>
              </div>
              <span className="w-28 shrink-0 truncate text-xs text-muted-foreground">{it.po_ref || '—'}</span>
              <span className="w-32 shrink-0 truncate text-xs text-muted-foreground">{it.selected_supplier_name || '—'}</span>
              <Select value={it.purchase_status || 'PENDING'} disabled={busy === it.id} onValueChange={v => setStatus(it, v)}>
                <SelectTrigger className="h-7 w-28 shrink-0 text-xs">
                  <SelectValue>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STATUS_TONE[it.purchase_status] || STATUS_TONE.PENDING}`}>
                      {it.purchase_status || 'PENDING'}
                    </span>
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {BOM_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          ))}
      </CardContent>
    </Card>
  );
}

// ---------- Suppliers (unchanged from the earlier build — kept, not part of the redesign spec) ----------

const SUPPLIER_FIELDS = [
  ['name', 'Name'], ['gst_no', 'GST No'], ['contact_person', 'Contact person'],
  ['phone', 'Phone'], ['email', 'Email'],
];

function SupplierEditForm({ supplier, onDone }) {
  const router = useRouter();
  const [form, setForm] = useState({
    name: supplier.name || '', gst_no: supplier.gst_no || '', contact_person: supplier.contact_person || '',
    phone: supplier.phone || '', email: supplier.email || '',
  });
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!form.name.trim()) return showToast('Name is required', 'error');
    setBusy(true);
    try {
      await api(`/api/suppliers/${supplier.id}`, { method: 'PATCH', body: form });
      showToast('Supplier updated'); router.refresh(); onDone();
    } catch (err) { showToast(err.message, 'error'); }
    setBusy(false);
  }
  async function deactivate() {
    if (!window.confirm(`Deactivate ${supplier.name}? They'll drop off this list.`)) return;
    setBusy(true);
    try {
      await api(`/api/suppliers/${supplier.id}`, { method: 'PATCH', body: { active: false } });
      showToast('Supplier deactivated'); router.refresh(); onDone();
    } catch (err) { showToast(err.message, 'error'); }
    setBusy(false);
  }

  return (
    <div className="grid grid-cols-2 gap-2">
      {SUPPLIER_FIELDS.map(([key, label]) => (
        <Input key={key} placeholder={label} value={form[key]} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
          className={key === 'email' ? 'col-span-2 h-8 text-xs' : 'h-8 text-xs'} />
      ))}
      <div className="col-span-2 flex gap-2">
        <Button size="sm" disabled={busy} onClick={save}>Save</Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={onDone}>Cancel</Button>
        <Button size="sm" variant="outline" disabled={busy} className="ml-auto text-destructive" onClick={deactivate}>Deactivate</Button>
      </div>
    </div>
  );
}

function Suppliers({ suppliers, quotes, q: search }) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(null);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: '', gst_no: '', contact_person: '', phone: '', email: '' });
  const [busy, setBusy] = useState(false);
  const needle = search.trim().toLowerCase();
  const shownSuppliers = suppliers.filter(s => !needle || s.name.toLowerCase().includes(needle));

  async function add(e) {
    e.preventDefault();
    if (!form.name.trim()) return;
    setBusy(true);
    try {
      await api('/api/suppliers', { method: 'POST', body: form });
      showToast('Supplier added');
      setForm({ name: '', gst_no: '', contact_person: '', phone: '', email: '' });
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); }
    setBusy(false);
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent className="flex flex-col divide-y pt-4">
          {suppliers.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">No suppliers yet — add one below.</p>}
          {suppliers.length > 0 && shownSuppliers.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">No suppliers match.</p>}
          {shownSuppliers.map(s => {
            const history = quotes.filter(q => q.supplier_id === s.id);
            return (
              <div key={s.id} className="py-2">
                <button className="flex w-full items-center justify-between text-left text-sm" onClick={() => setExpanded(expanded === s.id ? null : s.id)}>
                  <span className="font-medium">{s.name}</span>
                  <span className="text-xs text-muted-foreground">{history.length} quote{history.length !== 1 ? 's' : ''}</span>
                </button>
                {expanded === s.id && (
                  <div className="mt-2 flex flex-col gap-1.5 bg-muted/30 p-2 text-xs">
                    {editing === s.id ? (
                      <SupplierEditForm supplier={s} onDone={() => setEditing(null)} />
                    ) : (
                      <>
                        <div className="flex items-center justify-between">
                          <span>{s.contact_person && `${s.contact_person} · `}{s.phone}{s.email ? ` · ${s.email}` : ''}{s.gst_no ? ` · GST ${s.gst_no}` : ''}</span>
                          <button type="button" className="shrink-0 text-primary hover:underline" onClick={() => setEditing(s.id)}>Edit</button>
                        </div>
                        {history.length === 0 && <p className="text-muted-foreground">No quotes logged yet.</p>}
                        {history.map(q => (
                          <div key={q.id} className="flex items-center justify-between border-t pt-1.5 first:border-t-0 first:pt-0">
                            <span>{q.material_description} <span className="text-muted-foreground">· {q.project_no}</span></span>
                            <span className="text-muted-foreground">{formatMoney(q.unit_price)} · {formatDate(q.quoted_at)}</span>
                          </div>
                        ))}
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Add supplier</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={add} className="grid grid-cols-2 gap-3">
            <Input placeholder="Name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            <Input placeholder="GST No" value={form.gst_no} onChange={e => setForm(f => ({ ...f, gst_no: e.target.value }))} />
            <Input placeholder="Contact person" value={form.contact_person} onChange={e => setForm(f => ({ ...f, contact_person: e.target.value }))} />
            <Input placeholder="Phone" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
            <Input placeholder="Email" className="col-span-2" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
            <Button type="submit" disabled={busy || !form.name.trim()} className="col-span-2">Add supplier</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------- Root ----------

// One search placeholder per tab — same input, same position, different meaning depending on what's
// active (§4, point 4). Keyed by tab value.
const SEARCH_PLACEHOLDER = {
  sourcing: 'Search description or project…',
  selection: 'Search description or project…',
  orders: 'Search PO number or supplier…',
  state: 'Search description, project, PO…',
  suppliers: 'Search supplier name…',
};

export default function ProcurementWorkspace({ sourcingItems, suppliers, purchaseOrders, quotes }) {
  const router = useRouter();
  const [tab, setTab] = useState('sourcing');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [poView, setPoView] = useState('active');

  const quotesByItem = {};
  for (const quote of quotes) (quotesByItem[quote.bom_item_id] ||= []).push(quote);
  const activeItems = sourcingItems.filter(it => it.purchase_status !== 'CANCELLED');
  const fulfilledCount = purchaseOrders.filter(po => po.fulfilled).length;
  const activeOrderCount = purchaseOrders.length - fulfilledCount;

  return (
    <Tabs value={tab} onValueChange={setTab} className="flex-col gap-4">
      <TabsList variant="line" className="w-full justify-start px-0">
        <TabsTrigger value="sourcing" className="flex-none">Sourcing</TabsTrigger>
        <TabsTrigger value="selection" className="flex-none">Selection</TabsTrigger>
        <TabsTrigger value="orders" className="flex-none">Purchase Orders</TabsTrigger>
        <TabsTrigger value="state" className="flex-none">Status</TabsTrigger>
        {/* Suppliers is a real, standalone feature (§ Phase 2), not part of the Sourcing→Status
            lifecycle the other four tabs form — kept visually separate at the far right of the same
            bar rather than a floating sixth item or a second row. */}
        <TabsTrigger value="suppliers" className="ml-auto flex-none">Suppliers</TabsTrigger>
      </TabsList>
      {/* One shared search row, same position under the tab bar regardless of which tab is active,
          so switching tabs never makes the page jump (§4, point 4). Each tab interprets it. A
          tab-specific control (Status's status filter, Purchase Orders' Active/Fulfilled toggle)
          sits right-aligned in the same row rather than adding a second control row per tab. */}
      <div className="flex items-center gap-2">
        <Input value={search} onChange={e => setSearch(e.target.value)}
          placeholder={SEARCH_PLACEHOLDER[tab]} className="h-8 w-72" />
        {tab === 'state' && (
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="ml-auto h-8 w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {BOM_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        {tab === 'orders' && (
          <div className="ml-auto flex gap-1 rounded-md border p-0.5">
            <Button size="sm" variant={poView === 'active' ? 'secondary' : 'ghost'} className="h-7 px-2.5 text-xs"
              onClick={() => setPoView('active')}>Active ({activeOrderCount})</Button>
            <Button size="sm" variant={poView === 'fulfilled' ? 'secondary' : 'ghost'} className="h-7 px-2.5 text-xs"
              onClick={() => setPoView('fulfilled')}>Fulfilled ({fulfilledCount})</Button>
          </div>
        )}
      </div>
      <TabsContent value="sourcing"><Sourcing items={activeItems} quotesByItem={quotesByItem} suppliers={suppliers} router={router} q={search} /></TabsContent>
      <TabsContent value="selection"><Selection items={activeItems} quotesByItem={quotesByItem} router={router} q={search} /></TabsContent>
      <TabsContent value="orders"><PurchaseOrders orders={purchaseOrders} q={search} view={poView} /></TabsContent>
      <TabsContent value="state"><State items={sourcingItems} router={router} q={search} statusFilter={statusFilter} /></TabsContent>
      <TabsContent value="suppliers"><Suppliers suppliers={suppliers} quotes={quotes} q={search} /></TabsContent>
    </Tabs>
  );
}
