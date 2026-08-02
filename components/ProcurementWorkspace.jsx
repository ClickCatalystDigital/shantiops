'use client';

// Procurement's cross-project workbench (§5a) — three tabs: Sourcing (the daily worklist, segmented
// by where each item sits in the real process, multi-select + a contextual action bar), Purchase
// orders (issue/cancel/PDF), Suppliers (provisional list + price history). Reuses the
// select-all/action-bar interaction already established in ProcurementQueue.jsx.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, showToast } from '@/lib/client';
import { formatDate, formatMoney } from '@/lib/format';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './ui/tabs';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Label } from './ui/label';
import { Badge } from './ui/badge';
import { Checkbox } from './ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog';

const PAYMENT_TERMS = ['LC', 'Advance', 'After Delivery', 'PDC', 'COD'];
const RESOLVED = ['CLOSED', 'RECEIVED', 'CANCELLED'];
const SEGMENTS = [
  { key: 'to_source', label: 'To source' },
  { key: 'comparing', label: 'Comparing' },
  { key: 'on_order', label: 'On order' },
  { key: 'delivered', label: 'Delivered' },
  { key: 'cancelled', label: 'Cancelled' },
];

function segmentOf(item, quoteCount) {
  if (item.purchase_status === 'CANCELLED') return 'cancelled';
  if (RESOLVED.includes(item.purchase_status)) return 'delivered';
  if (item.selected_quote_id) return 'on_order';
  return quoteCount > 0 ? 'comparing' : 'to_source';
}

export default function ProcurementWorkspace({ sourcingItems, suppliers, purchaseOrders, quotes }) {
  const [tab, setTab] = useState('sourcing');
  return (
    <Tabs value={tab} onValueChange={setTab} className="flex-col gap-4">
      <TabsList variant="line" className="w-max justify-start px-0">
        <TabsTrigger value="sourcing">Sourcing</TabsTrigger>
        <TabsTrigger value="orders">Purchase orders</TabsTrigger>
        <TabsTrigger value="suppliers">Suppliers</TabsTrigger>
      </TabsList>
      <TabsContent value="sourcing"><Sourcing items={sourcingItems} suppliers={suppliers} quotes={quotes} /></TabsContent>
      <TabsContent value="orders"><PurchaseOrders orders={purchaseOrders} /></TabsContent>
      <TabsContent value="suppliers"><Suppliers suppliers={suppliers} quotes={quotes} /></TabsContent>
    </Tabs>
  );
}

// ---------- Sourcing ----------

function Sourcing({ items, suppliers, quotes }) {
  const router = useRouter();
  const [segment, setSegment] = useState('to_source');
  const [selected, setSelected] = useState(new Set());
  const [expanded, setExpanded] = useState(null);
  const [quoteDialog, setQuoteDialog] = useState(false);
  const [poDialog, setPoDialog] = useState(false);

  const quotesByItem = {};
  for (const q of quotes) (quotesByItem[q.bom_item_id] ||= []).push(q);

  const withSegment = items.map(it => ({ ...it, __segment: segmentOf(it, (quotesByItem[it.id] || []).length) }));
  const counts = Object.fromEntries(SEGMENTS.map(s => [s.key, withSegment.filter(i => i.__segment === s.key).length]));
  const shown = withSegment.filter(i => i.__segment === segment);

  function toggle(id) {
    setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function toggleAll() {
    setSelected(s => (s.size === shown.length ? new Set() : new Set(shown.map(i => i.id))));
  }
  function changeSegment(key) {
    setSegment(key); setSelected(new Set()); setExpanded(null);
  }

  const selectedItems = shown.filter(i => selected.has(i.id));

  function openPoDialog() {
    const supplierIds = new Set(selectedItems.map(i => i.selected_quote_id && quotes.find(q => q.id === i.selected_quote_id)?.supplier_id));
    if (supplierIds.size > 1) return showToast('All selected items must share one supplier', 'error');
    setPoDialog(true);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        {SEGMENTS.map(s => (
          <button key={s.key} onClick={() => changeSegment(s.key)}
            className={`rounded-md border px-3 py-1.5 text-sm ${segment === s.key ? 'border-foreground/30 bg-muted' : 'text-muted-foreground'}`}>
            {s.label} <span className="text-xs text-muted-foreground">{counts[s.key]}</span>
          </button>
        ))}
      </div>

      <Card>
        <CardContent className="flex flex-col gap-0 pt-4">
          {shown.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">Nothing here.</p>}
          {shown.length > 0 && (
            <div className="flex items-center gap-3 border-b pb-2 text-xs text-muted-foreground">
              <Checkbox checked={selected.size === shown.length} onCheckedChange={toggleAll} />
              <span>Select all</span>
            </div>
          )}
          {shown.map(it => (
            <div key={it.id} className="border-b last:border-b-0">
              <div className="flex items-center gap-3 py-2.5 text-sm">
                <Checkbox checked={selected.has(it.id)} onCheckedChange={() => toggle(it.id)} />
                <button className="min-w-0 flex-1 text-left" onClick={() => setExpanded(expanded === it.id ? null : it.id)}>
                  <span className="font-medium">{it.material_description}</span>
                  <span className="ml-2 text-xs text-muted-foreground">{it.project_no} · {it.qty_text}</span>
                </button>
                {it.__segment === 'on_order' && <span className="shrink-0 text-xs text-muted-foreground">{it.selected_supplier_name}</span>}
                {it.__segment === 'comparing' && <Badge variant="outline">{(quotesByItem[it.id] || []).length} quotes</Badge>}
                <Badge variant="outline">{it.purchase_status || 'PENDING'}</Badge>
              </div>
              {expanded === it.id && (
                <ItemDetail item={it} quotes={quotesByItem[it.id] || []} router={router} />
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      {selected.size > 0 && (
        <div className="sticky bottom-4 flex items-center gap-3 rounded-md border bg-background p-3 shadow-sm">
          <span className="text-sm text-muted-foreground">{selected.size} item{selected.size !== 1 ? 's' : ''} selected</span>
          {(segment === 'to_source' || segment === 'comparing') && (
            <Button size="sm" onClick={() => setQuoteDialog(true)}>Log quote</Button>
          )}
          {segment === 'on_order' && <Button size="sm" onClick={openPoDialog}>Create PO</Button>}
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setSelected(new Set())}>Clear</Button>
        </div>
      )}

      {quoteDialog && (
        <QuoteDialog items={selectedItems} suppliers={suppliers} router={router}
          onClose={() => { setQuoteDialog(false); setSelected(new Set()); }} />
      )}
      {poDialog && (
        <PoDialog items={selectedItems} quotes={quotes} router={router}
          onClose={() => { setPoDialog(false); setSelected(new Set()); }} />
      )}
    </div>
  );
}

function ItemDetail({ item, quotes, router }) {
  const [busy, setBusy] = useState(false);

  async function select(quoteId) {
    setBusy(true);
    try {
      await api(`/api/bom-items/${item.id}/select-supplier`, { method: 'POST', body: { quote_id: quoteId } });
      showToast('Supplier selected'); router.refresh();
    } catch (err) { showToast(err.message, 'error'); }
    setBusy(false);
  }
  async function revert() {
    setBusy(true);
    try {
      await api(`/api/bom-items/${item.id}/select-supplier`, { method: 'DELETE' });
      showToast('Selection reverted'); router.refresh();
    } catch (err) { showToast(err.message, 'error'); }
    setBusy(false);
  }

  return (
    <div className="flex flex-col gap-2 bg-muted/30 px-3 py-3 text-sm">
      <div className="text-xs text-muted-foreground">{item.moc} · {item.size_spec}</div>
      {item.selected_quote_id && (
        <div className="flex items-center justify-between rounded-md border bg-background px-3 py-2">
          <span>Selected: <strong>{item.selected_supplier_name}</strong> · {formatMoney(item.selected_unit_price)}{item.po_ref && <span className="ml-2 text-xs text-muted-foreground">PO {item.po_ref}</span>}</span>
          <button className="text-xs text-muted-foreground hover:text-destructive" disabled={busy} onClick={revert}>Revert</button>
        </div>
      )}
      {quotes.length === 0 && !item.selected_quote_id && (
        <p className="text-xs text-muted-foreground">No quotes logged yet — select this item and Log quote.</p>
      )}
      {quotes.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {quotes.map(q => (
            <div key={q.id} className={`flex items-center justify-between rounded-md border px-3 py-1.5 ${q.id === item.selected_quote_id ? 'border-foreground/30 bg-background' : ''}`}>
              <span>{q.supplier_name}</span>
              <span className="text-xs text-muted-foreground">{formatMoney(q.unit_price)}{q.expected_delivery_days ? ` · ${q.expected_delivery_days}d` : ''}{q.payment_terms ? ` · ${q.payment_terms}` : ''}</span>
              {q.id === item.selected_quote_id
                ? <Badge>Selected</Badge>
                : <button className="text-xs text-primary hover:underline" disabled={busy} onClick={() => select(q.id)}>Select</button>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function QuoteDialog({ items, suppliers, router, onClose }) {
  const [supplierId, setSupplierId] = useState('');
  const [newSupplier, setNewSupplier] = useState(false);
  const [newSupplierName, setNewSupplierName] = useState('');
  const [source, setSource] = useState('');
  const [days, setDays] = useState('');
  const [terms, setTerms] = useState('');
  const [advancePct, setAdvancePct] = useState('');
  const [prices, setPrices] = useState(() => Object.fromEntries(items.map(i => [i.id, ''])));
  const [uoms, setUoms] = useState(() => Object.fromEntries(items.map(i => [i.id, ''])));
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!newSupplier && !supplierId) return showToast('Pick a supplier', 'error');
    if (newSupplier && !newSupplierName.trim()) return showToast('Name the new supplier', 'error');
    for (const it of items) {
      if (!(Number(prices[it.id]) > 0)) return showToast(`Enter a price for ${it.material_description}`, 'error');
    }
    setBusy(true);
    try {
      let sid = supplierId;
      if (newSupplier) {
        const res = await api('/api/suppliers', { method: 'POST', body: { name: newSupplierName.trim() } });
        sid = res.id;
      }
      const paymentTerms = terms === 'Advance' && advancePct ? `Advance ${advancePct}%` : terms;
      await api('/api/supplier-quotes', {
        method: 'POST',
        body: {
          supplier_id: sid,
          items: items.map(it => ({ bom_item_id: it.id, unit_price: Number(prices[it.id]), uom: uoms[it.id] || undefined })),
          expected_delivery_days: days || undefined, payment_terms: paymentTerms || undefined, quote_source: source || undefined,
        },
      });
      showToast('Quote logged'); router.refresh(); onClose();
    } catch (err) { showToast(err.message, 'error'); }
    setBusy(false);
  }

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader><DialogTitle>Log a quote — {items.length} item{items.length !== 1 ? 's' : ''}</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Supplier</Label>
              {newSupplier ? (
                <Input value={newSupplierName} onChange={e => setNewSupplierName(e.target.value)} placeholder="New supplier name" autoFocus />
              ) : (
                <Select value={supplierId} onValueChange={setSupplierId}>
                  <SelectTrigger className="w-full"><SelectValue placeholder="Choose…" /></SelectTrigger>
                  <SelectContent>{suppliers.map(s => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}</SelectContent>
                </Select>
              )}
              <button type="button" className="w-fit text-xs text-primary hover:underline" onClick={() => setNewSupplier(v => !v)}>
                {newSupplier ? 'Pick existing supplier' : '+ New supplier'}
              </button>
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
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Expected delivery (days)</Label>
              <Input type="number" min="0" value={days} onChange={e => setDays(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Payment terms</Label>
              <Select value={terms} onValueChange={setTerms}>
                <SelectTrigger className="w-full"><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>{PAYMENT_TERMS.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          {terms === 'Advance' && (
            <div className="flex flex-col gap-1.5">
              <Label>Advance %</Label>
              <Input type="number" min="0" max="100" value={advancePct} onChange={e => setAdvancePct(e.target.value)} placeholder="e.g. 40" />
            </div>
          )}
          <div className="flex flex-col gap-2">
            <Label>Pricing</Label>
            {items.map(it => (
              <div key={it.id} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-sm">{it.material_description}</span>
                <Input className="w-28" type="number" min="0" step="0.01" placeholder="Unit price"
                  value={prices[it.id]} onChange={e => setPrices(p => ({ ...p, [it.id]: e.target.value }))} />
                <Input className="w-20" placeholder="UoM"
                  value={uoms[it.id]} onChange={e => setUoms(u => ({ ...u, [it.id]: e.target.value }))} />
              </div>
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button disabled={busy} onClick={submit}>{busy ? 'Saving…' : 'Log quote'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PoDialog({ items, quotes, router, onClose }) {
  const winningQuotes = items.map(it => quotes.find(q => q.id === it.selected_quote_id)).filter(Boolean);
  const supplierName = winningQuotes[0]?.supplier_name || '—';

  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [indentRef, setIndentRef] = useState('');
  const [discountPct, setDiscountPct] = useState('0');
  const [gstPct, setGstPct] = useState('18');
  const [instructions, setInstructions] = useState('');
  // Pre-filled from the winning quote(s) — they're what the supplier actually offered — but stay
  // editable since the PO is the document of record, not the quote.
  const [paymentTerms, setPaymentTerms] = useState(winningQuotes[0]?.payment_terms || '');
  const [quoteSource, setQuoteSource] = useState(winningQuotes[0]?.quote_source || '');
  const [quoteDate, setQuoteDate] = useState(winningQuotes[0]?.quoted_at?.slice(0, 10) || '');
  const [busy, setBusy] = useState(false);

  const subtotal = items.reduce((a, it) => {
    const qty = parseFloat(it.qty_text) || 1;
    return a + qty * (winningQuotes.find(q => q.id === it.selected_quote_id)?.unit_price || 0);
  }, 0);

  async function submit() {
    setBusy(true);
    try {
      const res = await api('/api/purchase-orders', {
        method: 'POST',
        body: {
          items: items.map(i => i.id), delivery_address: deliveryAddress || undefined, indent_ref: indentRef || undefined,
          discount_pct: Number(discountPct) || 0, gst_pct: Number(gstPct), special_instructions: instructions || undefined,
          payment_terms: paymentTerms || undefined, quote_source: quoteSource || undefined, quote_date: quoteDate || undefined,
        },
      });
      showToast(`PO ${res.po_no} created`); router.refresh(); onClose();
    } catch (err) { showToast(err.message, 'error'); }
    setBusy(false);
  }

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader><DialogTitle>Create PO — {supplierName}</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col divide-y rounded-md border text-sm">
            {items.map(it => (
              <div key={it.id} className="flex items-center justify-between px-3 py-1.5">
                <span className="truncate">{it.material_description}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{it.qty_text}</span>
              </div>
            ))}
          </div>
          <p className="text-sm text-muted-foreground">Subtotal (est.): {formatMoney(subtotal)}</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Payment terms</Label>
              <Select value={paymentTerms} onValueChange={setPaymentTerms}>
                <SelectTrigger className="w-full"><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>{PAYMENT_TERMS.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Quotation via</Label>
              <Select value={quoteSource} onValueChange={setQuoteSource}>
                <SelectTrigger className="w-full"><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="whatsapp">WhatsApp</SelectItem>
                  <SelectItem value="email">Email</SelectItem>
                  <SelectItem value="phone">Phone</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Quote date</Label>
              <Input type="date" value={quoteDate} onChange={e => setQuoteDate(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Indent / Job ref</Label>
              <Input value={indentRef} onChange={e => setIndentRef(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Discount %</Label>
              <Input type="number" min="0" max="100" value={discountPct} onChange={e => setDiscountPct(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>GST %</Label>
              <Input type="number" min="0" value={gstPct} onChange={e => setGstPct(e.target.value)} />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Delivery address (leave blank for factory)</Label>
            <Textarea rows={2} value={deliveryAddress} onChange={e => setDeliveryAddress(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Special instructions</Label>
            <Textarea rows={2} value={instructions} onChange={e => setInstructions(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button disabled={busy} onClick={submit}>{busy ? 'Creating…' : 'Create PO'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------- Purchase orders ----------

const PO_TONE = {
  draft: 'bg-muted text-muted-foreground',
  issued: 'bg-warning/10 text-warning ring-1 ring-inset ring-warning/20',
  cancelled: 'bg-danger/10 text-danger ring-1 ring-inset ring-danger/20',
};

function PurchaseOrders({ orders }) {
  const router = useRouter();
  const [busy, setBusy] = useState(null);

  async function issue(po) {
    setBusy(po.id);
    try {
      await api(`/api/purchase-orders/${po.id}`, { method: 'PATCH', body: { action: 'issue' } });
      showToast(`${po.po_no} issued`); router.refresh();
    } catch (err) { showToast(err.message, 'error'); }
    setBusy(null);
  }
  async function cancel(po) {
    const reason = window.prompt(`Cancel ${po.po_no} — why?`);
    if (reason === null) return;
    setBusy(po.id);
    try {
      await api(`/api/purchase-orders/${po.id}`, { method: 'PATCH', body: { action: 'cancel', reason } });
      showToast(`${po.po_no} cancelled`); router.refresh();
    } catch (err) { showToast(err.message, 'error'); }
    setBusy(null);
  }

  if (!orders.length) return <p className="py-10 text-center text-sm text-muted-foreground">No purchase orders yet.</p>;

  return (
    <Card>
      <CardContent className="flex flex-col divide-y pt-4">
        {orders.map(po => (
          <div key={po.id} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
            <span className="font-medium">{po.po_no}</span>
            <span className="text-muted-foreground">{po.supplier_name}</span>
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${PO_TONE[po.status] || ''}`}>{po.status}</span>
            <span className="text-xs text-muted-foreground">{po.item_count} item{po.item_count !== 1 ? 's' : ''} · {formatMoney(po.subtotal)}</span>
            <span className="text-xs text-muted-foreground">{formatDate(po.created_at)}</span>
            <div className="ml-auto flex gap-2">
              {po.status === 'draft' && (
                <button className="text-xs text-primary hover:underline" disabled={busy === po.id} onClick={() => issue(po)}>Issue</button>
              )}
              {po.status !== 'cancelled' && (
                <button className="text-xs text-muted-foreground hover:text-destructive" disabled={busy === po.id} onClick={() => cancel(po)}>Cancel</button>
              )}
              <Button asChild size="sm" variant="outline" className="h-6 px-2 text-xs">
                <a href={`/api/purchase-orders/${po.id}/pdf`} target="_blank" rel="noreferrer">PDF</a>
              </Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

// ---------- Suppliers ----------

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

function Suppliers({ suppliers, quotes }) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(null);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: '', gst_no: '', contact_person: '', phone: '', email: '' });
  const [busy, setBusy] = useState(false);

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
          {suppliers.map(s => {
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
