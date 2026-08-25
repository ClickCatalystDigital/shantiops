'use client';

// Procurement's cross-project workbench (§5a), rebuilt into the four-section sidebar flow from
// PROCUREMENT-CHANGES.md §4: Enquiry (gather quotes, create RFQs — V2-CHANGES.md Phase 5.1,
// replaces the original Sourcing tab per D1) -> Selection (compare/pick, auto-drafts a PO)
// -> Purchase Orders (issue/cancel-issue) -> Status (search + manual status override, always shows
// every accepted item regardless of stage — labeled "State" in the original spec, renamed for
// clarity in the Phase 4 polish pass). Suppliers stays a 5th sidebar item after
// the other four (it's a standalone feature, not part of their shared lifecycle) — not named in the
// redesign spec, but it's a real, working feature (add/edit/deactivate) with no other home, so it's
// kept rather than dropped. One shared search input lives above the active section, same position
// regardless of active section, filtering whichever section is open.
import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { api, showToast, formatDate, formatMoney } from '@/lib/client';
import { Card, CardContent, CardHeader, CardTitle, CardAction } from './ui/card';
import MasterImport from './MasterImport';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Label } from './ui/label';
import { Badge } from './ui/badge';
import { Checkbox } from './ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import PdfPreview from './PdfPreview';
import PaymentTermsField from './PaymentTermsField';
import CreateRfqDialog from './CreateRfqDialog';
import { PURCHASE_STATUSES as BOM_STATUSES, CLOSED_STATUSES, OPEN_STATUSES, STATUS_TONE, DEFAULT_PURCHASE_STATUS } from '@/lib/bom-fields.mjs';
import WorkspaceSidebar from '@/components/WorkspaceSidebar';
import SupplierAnalysis from '@/components/SupplierAnalysis';
import { SearchIcon, GitCompareIcon, FileTextIcon, ListChecksIcon, Building2Icon, ShoppingCartIcon, BarChart3Icon, LayoutDashboardIcon, Undo2Icon, PlusIcon, ReceiptIcon, TrashIcon, DownloadIcon } from 'lucide-react';

// Enquiry/Selection are for items still working toward a PO — once one's issued (Ordered, Phase
// 5.1 — was Transit pre-5.1) or closed out, it's Status's job to show it, not theirs.
const OUT_OF_PIPELINE = [...CLOSED_STATUSES, 'Ordered', 'Transit'];

// V2-CHANGES.md Group 6 Phase 6.4 — source='stock'/'sas' items point at the sentinel system
// project (project_is_system, from getSourcingItems) instead of a real one; reads better here as
// "SO #.../Stock" than the sentinel's literal placeholder project_no.
function projectLabel(it) {
  if (!it.project_is_system) return it.project_no;
  if (it.source === 'sas') return `SO #${it.sale_order_no || '—'}`;
  if (it.source === 'stock') return 'Stock';
  return it.project_no;
}

function ItemContext({ it }) {
  return (
    <p className="truncate text-xs text-muted-foreground">
      {projectLabel(it)} · {it.moc || '—'} · {it.size_spec || '—'} · {it.qty_text || '—'}
      {it.pr_ref && ` · PR ${it.pr_ref}`}
      {/* Group 5 Bundle A — the unified PR flow's structured pr_no/timestamp, distinct from the
          legacy free-text pr_ref above (kept for PMB-imported/manually-typed rows). */}
      {it.pr_no && ` · ${it.pr_no} · ${formatDate(it.pr_created_at)}`}
    </p>
  );
}

// ---------- Enquiry (was Sourcing) ----------

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

// RFQ suppliers for one item's expanded row (Phase 5.1) — lazy-fetched only once expanded, since
// the summary count alone (rfqSummary) is enough for the collapsed row.
function RfqSuppliersList({ rfqId, router }) {
  const [detail, setDetail] = useState(null);
  const [busy, setBusy] = useState(null);

  useEffect(() => {
    api(`/api/rfqs/${rfqId}`).then(setDetail).catch(() => setDetail(null));
  }, [rfqId]);

  async function resend(supplierId) {
    setBusy(supplierId);
    try {
      const d = await api(`/api/rfqs/${rfqId}`, { method: 'PATCH', body: { supplier_id: supplierId, action: 'resend' } });
      setDetail(d); showToast('New link issued'); router.refresh();
    } catch (err) { showToast(err.message, 'error'); }
    setBusy(null);
  }

  if (!detail) return null;
  return (
    <div className="flex flex-col gap-1 border-t pt-2">
      <p className="text-xs font-medium text-muted-foreground">{detail.rfq_no} — invited suppliers</p>
      {detail.suppliers.map(s => (
        <div key={s.id} className="flex items-center justify-between gap-2 text-xs">
          <span>{s.supplier_name}</span>
          <span className="flex items-center gap-2">
            {s.responded_at ? (
              <Badge variant="outline" className="text-success">Responded</Badge>
            ) : s.sent_at ? (
              <Badge variant="outline" className="text-muted-foreground">Sent, no reply</Badge>
            ) : (
              <Badge variant="outline" className="text-muted-foreground">Not sent</Badge>
            )}
            {!s.responded_at && (
              <button type="button" className="text-primary hover:underline" disabled={busy === s.supplier_id}
                onClick={() => resend(s.supplier_id)}>Resend</button>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}

function EnquiryRow({ it, quotes, suppliers, router, rfqSummary, selected, onToggle }) {
  const [expanded, setExpanded] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <div className="border-b last:border-b-0">
      <div className="flex w-full items-center gap-3 py-2.5 text-left text-sm">
        <input type="checkbox" className="size-4 shrink-0" checked={selected} onChange={onToggle} onClick={e => e.stopPropagation()} />
        <button className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => setExpanded(v => !v)}>
          <div className="min-w-0 flex-1">
            <span className="font-medium">{it.material_description}</span>
            <ItemContext it={it} />
          </div>
          {it.reserved_qty > 0 && (
            <Badge className="border-success/30 bg-success-surface text-success"
              title={`Partial stock — Stores already reserved ${it.reserved_qty} from inventory. This line's quantity (${it.qty_text || 'remaining'}) is only the unreserved shortfall; do not source the reserved portion again.`}>
              Partial stock — {it.reserved_qty} reserved, this line is the shortfall
            </Badge>
          )}
          {(quotes.length > 0 || rfqSummary) && (
            <Badge variant="outline">
              {quotes.length > 0 ? `${quotes.length} quote${quotes.length !== 1 ? 's' : ''}` : rfqSummary.rfq_no}
              {rfqSummary && ` · ${rfqSummary.responded}/${rfqSummary.invited} responded`}
            </Badge>
          )}
        </button>
      </div>
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
          {rfqSummary && <RfqSuppliersList rfqId={rfqSummary.rfq_id} router={router} />}
        </div>
      )}
      {dialogOpen && (
        <AddQuoteDialog item={it} suppliers={suppliers} router={router} onClose={() => setDialogOpen(false)} />
      )}
    </div>
  );
}

function Enquiry({ items, quotesByItem, suppliers, rfqSummaryByItem, router, q }) {
  const needle = q.trim().toLowerCase();
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [rfqDialogOpen, setRfqDialogOpen] = useState(false);
  const shown = items.filter(it => !it.selected_quote_id && !OUT_OF_PIPELINE.includes(it.purchase_status))
    .filter(it => !needle || it.material_description.toLowerCase().includes(needle) || it.project_no.toLowerCase().includes(needle));
  const shownIds = shown.map(it => it.id);
  const allShownSelected = shownIds.length > 0 && shownIds.every(id => selectedIds.has(id));

  function toggle(id) {
    setSelectedIds(s => { const next = new Set(s); next.has(id) ? next.delete(id) : next.add(id); return next; });
  }
  function toggleAllShown() {
    setSelectedIds(s => {
      if (allShownSelected) { const next = new Set(s); shownIds.forEach(id => next.delete(id)); return next; }
      return new Set([...s, ...shownIds]);
    });
  }
  const selectedItems = items.filter(it => selectedIds.has(it.id));

  return (
    <Card>
      <CardContent className="flex flex-col pt-4">
        {shown.length > 0 && (
          <div className="mb-2 flex items-center gap-3 border-b pb-2">
            <input type="checkbox" className="size-4" checked={allShownSelected} onChange={toggleAllShown} />
            <span className="text-xs text-muted-foreground">Select all ({shown.length})</span>
            {selectedIds.size > 0 && (
              <div className="ml-auto flex items-center gap-2">
                <span className="text-xs text-muted-foreground">{selectedIds.size} selected</span>
                <Button size="sm" onClick={() => setRfqDialogOpen(true)}>Create RFQ</Button>
                <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())}>Clear</Button>
              </div>
            )}
          </div>
        )}
        {shown.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">Nothing to enquire right now.</p>}
        {shown.map(it => (
          <EnquiryRow key={it.id} it={it} quotes={quotesByItem[it.id] || []} suppliers={suppliers} router={router}
            rfqSummary={rfqSummaryByItem[it.id]} selected={selectedIds.has(it.id)} onToggle={() => toggle(it.id)} />
        ))}
      </CardContent>
      {rfqDialogOpen && (
        <CreateRfqDialog items={selectedItems} suppliers={suppliers} router={router}
          onClose={() => setRfqDialogOpen(false)}
          onCreated={() => { setSelectedIds(new Set()); setRfqDialogOpen(false); router.refresh(); }} />
      )}
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

// Group 5 Bundle A (5.3, D11) — draft-only PO editing: qty/rate per line, or re-pointing a line at
// a different supplier (pick an already-logged quote, or add a brand-new one inline — same
// existing/new-supplier shape as AddQuoteDialog above). A plain Dialog stacked on top of the PDF
// preview rather than squeezed into PdfPreview.jsx itself — that component is shared by QC/packing
// PDFs too and has no generic content slot, so editing lives in its own small dialog instead.
function ChangeSupplierPanel({ line, suppliers, onDone, onCancel }) {
  const [quotes, setQuotes] = useState(null);
  const [quoteId, setQuoteId] = useState('');
  const [addingNew, setAddingNew] = useState(false);
  const [newSupplierMode, setNewSupplierMode] = useState(false);
  const [supplierId, setSupplierId] = useState('');
  const [newSupplierName, setNewSupplierName] = useState('');
  const [price, setPrice] = useState('');
  const [uom, setUom] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api(`/api/bom-items/${line.bom_item_id}/quotes`).then(setQuotes).catch(() => setQuotes([]));
  }, [line.bom_item_id]);

  async function save() {
    setBusy(true);
    try {
      const body = { action: 'change_supplier', po_item_id: line.id };
      if (addingNew) {
        if (!newSupplierMode && !supplierId) return showToast('Pick a supplier', 'error');
        if (newSupplierMode && !newSupplierName.trim()) return showToast('Name the new supplier', 'error');
        if (!(Number(price) > 0)) { showToast('Enter a price', 'error'); setBusy(false); return; }
        body.new_quote = {
          supplier_id: newSupplierMode ? undefined : supplierId,
          new_supplier_name: newSupplierMode ? newSupplierName.trim() : undefined,
          unit_price: Number(price), uom: uom || undefined,
        };
      } else {
        if (!quoteId) { showToast('Pick a quote', 'error'); setBusy(false); return; }
        body.quote_id = Number(quoteId);
      }
      await api(`/api/purchase-orders/${line.po_id}`, { method: 'PATCH', body });
      showToast('Supplier changed');
      onDone();
    } catch (err) { showToast(err.message, 'error'); }
    setBusy(false);
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border bg-muted/30 p-3 text-sm">
      {!addingNew ? (
        <>
          <Select value={quoteId} onValueChange={setQuoteId} disabled={!quotes?.length}>
            <SelectTrigger className="w-full"><SelectValue placeholder={quotes === null ? 'Loading quotes…' : quotes.length ? 'Pick a logged quote…' : 'No other quotes logged'} /></SelectTrigger>
            <SelectContent>
              {/* po_items carries no selected_quote_id (that lives on bom_items) — picking the
                  current supplier's own quote again is a harmless no-op re-point, so the list is
                  every logged quote, not excluding one. */}
              {(quotes || []).map(q => (
                <SelectItem key={q.id} value={String(q.id)}>{q.supplier_name} · {formatMoney(q.unit_price)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <button type="button" className="w-fit text-xs text-primary hover:underline" onClick={() => setAddingNew(true)}>+ Add a new supplier's quote instead</button>
        </>
      ) : (
        <>
          {newSupplierMode ? (
            <Input value={newSupplierName} onChange={e => setNewSupplierName(e.target.value)} placeholder="New supplier name" autoFocus />
          ) : (
            <Select value={supplierId} onValueChange={setSupplierId}>
              <SelectTrigger className="w-full"><SelectValue placeholder="Choose a supplier…" /></SelectTrigger>
              <SelectContent>{suppliers.map(s => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}</SelectContent>
            </Select>
          )}
          <button type="button" className="w-fit text-xs text-primary hover:underline" onClick={() => setNewSupplierMode(v => !v)}>
            {newSupplierMode ? 'Pick existing supplier' : '+ Add a new supplier'}
          </button>
          <div className="grid grid-cols-2 gap-2">
            <Input type="number" min="0" step="0.01" value={price} onChange={e => setPrice(e.target.value)} placeholder="Unit price" />
            <Input value={uom} onChange={e => setUom(e.target.value)} placeholder="UoM (e.g. Kg, No)" />
          </div>
          <button type="button" className="w-fit text-xs text-primary hover:underline" onClick={() => setAddingNew(false)}>Pick an existing quote instead</button>
        </>
      )}
      <div className="flex gap-2">
        <Button size="sm" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

function EditPoLinesDialog({ po, suppliers, onClose, onPoGone, router }) {
  const [detail, setDetail] = useState(null);
  const [drafts, setDrafts] = useState({}); // po_item_id -> { qty, rate }
  const [changingId, setChangingId] = useState(null);
  const [busyId, setBusyId] = useState(null);

  useEffect(() => {
    api(`/api/purchase-orders/${po.id}`).then(d => {
      setDetail(d);
      setDrafts(Object.fromEntries(d.items.map(it => [it.id, { qty: String(it.qty), rate: String(it.rate) }])));
    }).catch(() => {});
  }, [po.id]);

  function setDraft(id, patch) { setDrafts(d => ({ ...d, [id]: { ...d[id], ...patch } })); }

  async function saveLine(line) {
    setBusyId(line.id);
    try {
      await api(`/api/purchase-orders/${po.id}`, {
        method: 'PATCH',
        body: { action: 'edit_item', po_item_id: line.id, qty: Number(drafts[line.id].qty), rate: Number(drafts[line.id].rate) },
      });
      showToast('Line updated'); router.refresh();
      const d = await api(`/api/purchase-orders/${po.id}`); setDetail(d);
    } catch (err) { showToast(err.message, 'error'); }
    setBusyId(null);
  }

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader><DialogTitle>Edit {po.po_no} — draft</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-3">
          {!detail && <p className="text-sm text-muted-foreground">Loading…</p>}
          {detail?.items.map(line => (
            <div key={line.id} className="flex flex-col gap-2 rounded-md border p-3 text-sm">
              <p className="font-medium">{line.description}</p>
              <div className="grid grid-cols-2 gap-2">
                <div className="flex flex-col gap-1">
                  <Label className="text-xs">Qty</Label>
                  <Input type="number" min="0" step="0.01" value={drafts[line.id]?.qty || ''}
                    onChange={e => setDraft(line.id, { qty: e.target.value })} />
                </div>
                <div className="flex flex-col gap-1">
                  <Label className="text-xs">Rate</Label>
                  <Input type="number" min="0" step="0.01" value={drafts[line.id]?.rate || ''}
                    onChange={e => setDraft(line.id, { rate: e.target.value })} />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" disabled={busyId === line.id} onClick={() => saveLine(line)}>Save</Button>
                {line.bom_item_id && (
                  <button type="button" className="text-xs text-primary hover:underline"
                    onClick={() => setChangingId(changingId === line.id ? null : line.id)}>
                    {changingId === line.id ? 'Cancel change' : 'Change supplier'}
                  </button>
                )}
              </div>
              {changingId === line.id && (
                <ChangeSupplierPanel line={line} suppliers={suppliers}
                  onDone={async () => {
                    setChangingId(null);
                    router.refresh();
                    // Moving the PO's last line onto a different supplier's draft deletes this PO
                    // (same "empty draft cleans itself up" behavior removeItemFromDraftPO already
                    // has everywhere else) — re-fetching it 404s, so close the whole editor instead
                    // of trying to refresh a PO that may no longer exist.
                    try {
                      const d = await api(`/api/purchase-orders/${po.id}`);
                      setDetail(d);
                      setDrafts(Object.fromEntries(d.items.map(it => [it.id, { qty: String(it.qty), rate: String(it.rate) }])));
                    } catch {
                      onClose();
                      onPoGone();
                    }
                  }}
                  onCancel={() => setChangingId(null)} />
              )}
            </div>
          ))}
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Done</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// The PO detail view — a centered PDF.js preview (PdfPreview) rather than an embedded iframe, so it
// renders regardless of the browser's own PDF-viewer/download settings, plus real width for a dense
// PO. Every status action lives in the footer alongside the shared Download button. Reuses whatever
// handler/busy state the parent (PurchaseOrders) passes down — no duplicated logic, just relocated.
function PODrawer({ po, suppliers, router, onClose, onIssue, onUnissue, onCancel, busy, tdsRates = [] }) {
  const [editing, setEditing] = useState(false);
  const [recordingBill, setRecordingBill] = useState(false);
  return (
    <>
      <PdfPreview
        open
        onOpenChange={o => !o && onClose()}
        url={`/api/purchase-orders/${po.id}/pdf`}
        title={po.po_no}
        description={
          <>
            {po.supplier_name} · {po.item_count} item{po.item_count !== 1 ? 's' : ''} · {formatMoney(po.subtotal)}
            {' · '}
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${PO_TONE[po.status] || ''}`}>{po.status}</span>
          </>
        }
        filename={`${po.po_no.replace(/\//g, '-')}.pdf`}
        actions={
          <>
            {/* Group 5 Bundle A (5.3) — draft-only, per D11: an issued PO is locked, Cancel Issue
                gets you back to draft first. */}
            {po.status === 'draft' && (
              <Button variant="outline" disabled={busy} onClick={() => setEditing(true)}>Edit</Button>
            )}
            {po.status === 'draft' && (
              <Button disabled={busy} onClick={() => onIssue(po)}>{busy ? 'Issuing…' : 'Issue'}</Button>
            )}
            {po.status === 'issued' && (
              <Button variant="outline" disabled={busy} onClick={() => onUnissue(po)}>Cancel Issue</Button>
            )}
            {/* ACCOUNTING-IMPLEMENTATION-PLAN.md Phase 3 — same relationship a GRN already has to a
                PO: record the supplier's bill once goods are physically in. Available any time the
                PO is issued rather than gated on a per-line receipt status, which lives on the
                linked bom_items, not the PO itself. */}
            {po.status === 'issued' && (
              <Button variant="outline" disabled={busy} onClick={() => setRecordingBill(true)}>Record Bill</Button>
            )}
            {po.status !== 'cancelled' && (
              <Button variant="ghost" className="text-destructive hover:text-destructive" disabled={busy} onClick={() => onCancel(po)}>Cancel PO</Button>
            )}
          </>
        }
      />
      {editing && (
        <EditPoLinesDialog po={po} suppliers={suppliers} router={router}
          onClose={() => setEditing(false)} onPoGone={onClose} />
      )}
      {recordingBill && (
        <RecordBillDialog po={po} tdsRates={tdsRates} router={router} onClose={() => setRecordingBill(false)} />
      )}
    </>
  );
}

// --- Vendor Bills + Debit Notes (ACCOUNTING-IMPLEMENTATION-PLAN.md Phase 3) ------------------------

function RecordBillDialog({ po, tdsRates, onClose, router }) {
  const [billNo, setBillNo] = useState('');
  const [billDate, setBillDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [gstRatePct, setGstRatePct] = useState('18');
  const [tdsRateId, setTdsRateId] = useState('none');
  const [isReverseCharge, setIsReverseCharge] = useState(false);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!billNo.trim()) return showToast('Bill number is required', 'error');
    setSaving(true);
    try {
      const res = await api(`/api/purchase-orders/${po.id}/record-bill`, {
        method: 'POST',
        body: { bill_no: billNo, bill_date: billDate, gst_rate_pct: Number(gstRatePct) || 0, tds_rate_id: tdsRateId === 'none' ? null : Number(tdsRateId), is_reverse_charge: isReverseCharge },
      });
      showToast(`Vendor Bill ${res.bill_no} recorded`);
      router.refresh();
      onClose();
    } catch (err) { showToast(err.message, 'error'); } finally { setSaving(false); }
  }

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Record Bill against {po.po_no}</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="grid gap-1.5"><Label>Supplier's bill number</Label><Input value={billNo} onChange={e => setBillNo(e.target.value)} /></div>
          <div className="grid gap-1.5"><Label>Bill date</Label><Input type="date" value={billDate} onChange={e => setBillDate(e.target.value)} /></div>
          <div className="grid gap-1.5"><Label>GST %</Label><Input type="number" value={gstRatePct} onChange={e => setGstRatePct(e.target.value)} /></div>
          <div className="grid gap-1.5">
            <Label>Vendor TDS (optional)</Label>
            <Select value={tdsRateId} onValueChange={setTdsRateId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No TDS deduction</SelectItem>
                {tdsRates.map(r => <SelectItem key={r.id} value={String(r.id)}>{r.section}{r.legacy_section ? ` (${r.legacy_section})` : ''} — {r.rate_pct}%{r.description ? ` (${r.description})` : ''}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id="vb-rcm" checked={isReverseCharge} onCheckedChange={v => setIsReverseCharge(!!v)} />
            <Label htmlFor="vb-rcm" className="font-normal">Reverse charge (RCM) — vendor's invoice carries no GST, we self-assess it</Label>
          </div>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={saving}>{saving ? 'Recording…' : 'Record Bill'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DebitNoteDialog({ bill, onClose, router }) {
  const [reason, setReason] = useState('');
  const [items, setItems] = useState([{ item_description: '', amount: '' }]);
  const [saving, setSaving] = useState(false);

  function updateItem(i, patch) { setItems(prev => prev.map((it, idx) => idx === i ? { ...it, ...patch } : it)); }
  function addRow() { setItems(prev => [...prev, { item_description: '', amount: '' }]); }
  function removeRow(i) { setItems(prev => prev.filter((_, idx) => idx !== i)); }

  async function save() {
    const cleanItems = items.filter(it => it.item_description.trim() && it.amount !== '').map(it => ({ ...it, amount: Number(it.amount) }));
    if (!cleanItems.length) return showToast('At least one line item is required', 'error');
    setSaving(true);
    try {
      const res = await api(`/api/vendor-bills/${bill.id}/debit-note`, { method: 'POST', body: { reason, items: cleanItems } });
      showToast(`Debit Note ${res.debit_note_no} created`);
      router.refresh();
      onClose();
    } catch (err) { showToast(err.message, 'error'); } finally { setSaving(false); }
  }

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Debit Note against {bill.bill_no}</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="grid gap-1.5"><Label>Reason</Label><Input value={reason} onChange={e => setReason(e.target.value)} /></div>
          <div className="flex flex-col gap-2">
            <Label>Line items</Label>
            {items.map((it, i) => (
              <div key={i} className="flex items-start gap-2">
                <Input placeholder="Description" value={it.item_description} onChange={e => updateItem(i, { item_description: e.target.value })} />
                <Input placeholder="Amount" type="number" value={it.amount} onChange={e => updateItem(i, { amount: e.target.value })} className="w-32" />
                <Button size="sm" variant="ghost" onClick={() => removeRow(i)}><TrashIcon className="size-4" /></Button>
              </div>
            ))}
            <Button size="sm" variant="outline" onClick={addRow}><PlusIcon />Add line</Button>
          </div>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Create Debit Note'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const BILL_STATUSES = ['draft', 'approved', 'paid', 'cancelled'];

function VendorBillsTab({ vendorBills, debitNotes, router }) {
  const [busyId, setBusyId] = useState(null);
  const [debitNoteFor, setDebitNoteFor] = useState(null);

  async function setStatus(bill, status) {
    setBusyId(bill.id);
    try {
      await api(`/api/vendor-bills/${bill.id}`, { method: 'PATCH', body: { status } });
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); } finally { setBusyId(null); }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader><CardTitle>Vendor Bills</CardTitle></CardHeader>
        <CardContent>
          {vendorBills.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">No bills recorded yet — open an issued PO and use Record Bill.</p> : (
            <Table>
              <TableHeader><TableRow><TableHead>Bill No.</TableHead><TableHead>PO</TableHead><TableHead>Supplier</TableHead><TableHead>Payable</TableHead><TableHead>Status</TableHead><TableHead /></TableRow></TableHeader>
              <TableBody>
                {vendorBills.map(vb => (
                  <TableRow key={vb.id}>
                    <TableCell className="font-medium">{vb.bill_no}</TableCell>
                    <TableCell>{vb.po_no}</TableCell>
                    <TableCell>{vb.supplier_name}</TableCell>
                    <TableCell className="tnum">{formatMoney(vb.payable_amount)}{vb.tds_amount > 0 && <span className="ml-1 text-xs text-muted-foreground">(TDS {formatMoney(vb.tds_amount)})</span>}</TableCell>
                    <TableCell>
                      <Select value={vb.status} onValueChange={v => setStatus(vb, v)} disabled={busyId === vb.id}>
                        <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                        <SelectContent>{BILL_STATUSES.map(s => <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>)}</SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="flex gap-2">
                      <Button asChild size="sm" variant="outline">
                        <a href={`/api/vendor-bills/${vb.id}/pdf`} target="_blank" rel="noreferrer"><DownloadIcon data-icon="inline-start" />PDF</a>
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setDebitNoteFor(vb)}>Debit Note</Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Debit Notes</CardTitle></CardHeader>
        <CardContent>
          {debitNotes.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">No debit notes yet.</p> : (
            <div className="flex flex-col divide-y">
              {debitNotes.map(dn => (
                <div key={dn.id} className="flex justify-between py-2 text-sm">
                  <span>{dn.debit_note_no} — against {dn.bill_no}{dn.reason ? ` (${dn.reason})` : ''}</span>
                  <span className="tnum font-medium">{formatMoney(dn.amount)}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      {debitNoteFor && <DebitNoteDialog bill={debitNoteFor} router={router} onClose={() => setDebitNoteFor(null)} />}
    </div>
  );
}

function PurchaseOrders({ orders, q, view, suppliers, tdsRates = [] }) {
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
          <span className="w-24 shrink-0">Project</span>
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
            <span className="w-24 shrink-0 truncate text-xs text-muted-foreground">
              {po.project_count > 1 ? 'Multiple' : po.first_project_is_system
                ? (po.first_bom_source === 'sas' ? `SO #${po.first_sale_order_no || '—'}` : 'Stock')
                : (po.first_project_no || '—')}
            </span>
            <span className={`w-20 shrink-0 rounded-full px-2 py-0.5 text-center text-xs font-medium ${PO_TONE[po.status] || ''}`}>{po.status}</span>
            <span className="w-32 shrink-0 text-xs text-muted-foreground">{po.item_count} item{po.item_count !== 1 ? 's' : ''} · {formatMoney(po.subtotal)}</span>
            <span className="w-20 shrink-0 text-right text-xs text-muted-foreground">{formatDate(po.created_at)}</span>
          </button>
        ))}
      </CardContent>
      {viewing && (
        <PODrawer po={viewing} suppliers={suppliers} router={router} onClose={() => setViewingId(null)}
          onIssue={issue} onUnissue={unissue} onCancel={cancel} busy={busy === viewing.id} tdsRates={tdsRates} />
      )}
    </Card>
  );
}

// ---------- State ----------

function State({ items, router, q, statusFilter }) {
  const [busy, setBusy] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [bulkStatus, setBulkStatus] = useState(DEFAULT_PURCHASE_STATUS);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkProgress, setBulkProgress] = useState(null); // { done, total } while a bulk apply is running
  const [closeProject, setCloseProject] = useState('all');
  const needle = q.trim().toLowerCase();
  const shown = items.filter(it => !needle
    || it.material_description.toLowerCase().includes(needle)
    || it.project_no.toLowerCase().includes(needle)
    || (it.po_ref || '').toLowerCase().includes(needle))
    .filter(it => statusFilter === 'all' || (it.purchase_status || DEFAULT_PURCHASE_STATUS) === statusFilter);
  const shownIds = shown.map(it => it.id);
  const allShownSelected = shownIds.length > 0 && shownIds.every(id => selected.has(id));
  // "Close BOM" convenience — every distinct project this tab has any line for, so Procurement can
  // pick one and select all its still-open lines in a click instead of search+select-all by hand.
  const allProjects = useMemo(() => [...new Set(items.map(it => it.project_no))].sort(), [items]);

  // Preselects every open-status line in the chosen project; doesn't touch bulkStatus or apply
  // anything itself — the existing "N selected" bar's status dropdown + Apply button (already
  // supports Received/Cancelled/In-Stock, all equally "closed") stays the one place that decides
  // what they close as.
  function closeBom() {
    const ids = items.filter(it => it.project_no === closeProject && OPEN_STATUSES.has(it.purchase_status || DEFAULT_PURCHASE_STATUS)).map(it => it.id);
    if (!ids.length) return showToast('Nothing open in that project', 'warning');
    if (!window.confirm(`Select all ${ids.length} still-open item${ids.length === 1 ? '' : 's'} in ${closeProject}? You'll still choose the status and confirm below.`)) return;
    setSelected(new Set(ids));
  }

  async function setStatus(it, value) {
    setBusy(it.id);
    try {
      await api(`/api/bom-items/${it.id}`, { method: 'PATCH', body: { purchase_status: value } });
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); }
    setBusy(null);
  }

  function toggleOne(id, checked) {
    setSelected(prev => {
      const next = new Set(prev);
      if (checked) next.add(id); else next.delete(id);
      return next;
    });
  }

  // Select-all always scopes to the currently visible (searched + status-filtered) rows, not the
  // whole tab — clicking it again with everything shown already selected deselects just that same
  // visible set, leaving any selection made under a different filter untouched (Gmail-style "select
  // all" semantics, not a hard reset).
  function toggleAllShown() {
    setSelected(prev => {
      const next = new Set(prev);
      if (allShownSelected) shownIds.forEach(id => next.delete(id));
      else shownIds.forEach(id => next.add(id));
      return next;
    });
  }

  async function applyBulkStatus() {
    const ids = [...selected];
    if (!ids.length) return;
    setBulkBusy(true);
    setBulkProgress({ done: 0, total: ids.length });
    let failed = 0;
    for (const id of ids) {
      try {
        await api(`/api/bom-items/${id}`, { method: 'PATCH', body: { purchase_status: bulkStatus } });
      } catch { failed++; }
      setBulkProgress(p => ({ done: p.done + 1, total: p.total }));
    }
    setBulkBusy(false);
    setBulkProgress(null);
    setSelected(new Set());
    showToast(failed ? `${ids.length - failed} of ${ids.length} updated — ${failed} failed` : `${ids.length} item${ids.length === 1 ? '' : 's'} updated`,
      failed ? 'warning' : undefined);
    router.refresh();
  }

  return (
    <Card>
      {allProjects.length > 0 && (
        <div className="flex items-center gap-2 border-b px-4 py-2 text-sm">
          <Select value={closeProject} onValueChange={setCloseProject}>
            <SelectTrigger className="h-7 w-44 text-xs"><SelectValue placeholder="Choose a project…" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all" disabled>Choose a project…</SelectItem>
              {allProjects.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" className="h-7" disabled={closeProject === 'all'} onClick={closeBom}>
            Close BOM
          </Button>
        </div>
      )}
      {selected.size > 0 && (
        <div className="flex items-center gap-2 border-b bg-muted/40 px-4 py-2 text-sm">
          <span className="font-medium">{selected.size} selected</span>
          <Select value={bulkStatus} onValueChange={setBulkStatus} disabled={bulkBusy}>
            <SelectTrigger className="h-7 w-36 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {BOM_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button size="sm" className="h-7" disabled={bulkBusy} onClick={applyBulkStatus}>
            {bulkBusy ? `Updating ${bulkProgress?.done ?? 0}/${bulkProgress?.total ?? 0}…` : 'Apply'}
          </Button>
          <Button size="sm" variant="ghost" className="h-7" disabled={bulkBusy} onClick={() => setSelected(new Set())}>
            Clear
          </Button>
        </div>
      )}
      {shown.length > 0 && (
        <div className="flex items-center gap-3 border-b px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <Checkbox className="shrink-0" checked={allShownSelected} onCheckedChange={toggleAllShown} aria-label="Select all shown" />
          <span className="flex-1">Part Description</span>
          <span className="w-24 shrink-0">Project</span>
          <span className="w-28 shrink-0">PO No.</span>
          <span className="w-32 shrink-0">Make</span>
          <span className="w-28 shrink-0">Status</span>
        </div>
      )}
      <CardContent className="flex flex-col divide-y pt-4">
        {shown.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">No items match.</p>}
        {shown.map(it => (
            <div key={it.id} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
              <Checkbox className="shrink-0" checked={selected.has(it.id)} onCheckedChange={v => toggleOne(it.id, !!v)} aria-label="Select item" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{it.material_description}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {it.moc || '—'} · {it.size_spec || '—'} · {it.qty_text || '—'}
                  {it.pr_ref && ` · PR ${it.pr_ref}`}
                </p>
              </div>
              <span className="w-24 shrink-0 truncate text-xs text-muted-foreground">{projectLabel(it)}</span>
              <span className="w-28 shrink-0 truncate text-xs text-muted-foreground">{it.po_ref || '—'}</span>
              <span className="w-32 shrink-0 truncate text-xs text-muted-foreground">{it.selected_supplier_name || '—'}</span>
              <Select value={it.purchase_status || DEFAULT_PURCHASE_STATUS} disabled={busy === it.id} onValueChange={v => setStatus(it, v)}>
                <SelectTrigger className="h-7 w-28 shrink-0 text-xs">
                  <SelectValue>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STATUS_TONE[it.purchase_status] || STATUS_TONE[DEFAULT_PURCHASE_STATUS]}`}>
                      {it.purchase_status || DEFAULT_PURCHASE_STATUS}
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
        <CardHeader>
          <CardTitle className="text-base">Add supplier</CardTitle>
          {/* V2-CHANGES.md Group 3 — bulk vendor import from the client's real STERP master file,
              full-replace on confirm. Manual add below stays for one-off additions/corrections. */}
          <CardAction><MasterImport type="suppliers" label="Suppliers" /></CardAction>
        </CardHeader>
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
// --- Purchase Returns (STERP item 13, §5o) — direct mirror of SalesWorkspace's ReturnsTab, same
// lifecycle shape, opposite stock direction (removes from on-hand instead of crediting it back). --

function AddPurchaseReturnDialog({ purchaseOrders, onClose, router }) {
  const [poId, setPoId] = useState('');
  const [description, setDescription] = useState('');
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!poId) return showToast('Purchase Order is required', 'error');
    if (!description.trim()) return showToast('Item description is required', 'error');
    if (!(Number(qty) > 0)) return showToast('Quantity must be a positive number', 'error');
    setSaving(true);
    try {
      await api('/api/purchase-returns', {
        method: 'POST',
        body: { po_id: poId, item_description: description.trim(), qty: Number(qty), reason: reason.trim() || null },
      });
      showToast('Return raised');
      router.refresh();
      onClose();
    } catch (err) { showToast(err.message, 'error'); } finally { setSaving(false); }
  }

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Raise a Purchase Return</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="grid gap-1.5">
            <Label>Purchase Order</Label>
            <Select value={poId} onValueChange={setPoId}>
              <SelectTrigger><SelectValue placeholder="Choose Purchase Order" /></SelectTrigger>
              <SelectContent>{purchaseOrders.map(po => <SelectItem key={po.id} value={String(po.id)}>{po.po_no}{po.supplier_name ? ` · ${po.supplier_name}` : ''}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5"><Label>Item description</Label><Input value={description} onChange={e => setDescription(e.target.value)} autoFocus /></div>
          <div className="grid gap-1.5 sm:w-32"><Label>Quantity</Label><Input type="number" value={qty} onChange={e => setQty(e.target.value)} /></div>
          <div className="grid gap-1.5"><Label>Reason (optional)</Label><Input value={reason} onChange={e => setReason(e.target.value)} placeholder="Wrong spec, damaged on receipt, over-supply…" /></div>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Raise Return'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PurchaseReturnRow({ ret, inventoryItems, router }) {
  const [busy, setBusy] = useState(false);
  const [invPick, setInvPick] = useState(ret.inventory_item_id ? String(ret.inventory_item_id) : '');
  const [debitRef, setDebitRef] = useState(ret.debit_note_ref || '');

  async function patch(body) {
    setBusy(true);
    try {
      await api(`/api/purchase-returns/${ret.id}`, { method: 'PATCH', body });
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); }
    setBusy(false);
  }

  return (
    <TableRow>
      <TableCell className="font-medium">{ret.po_no}<div className="text-xs font-normal text-muted-foreground">{ret.supplier_name}</div></TableCell>
      <TableCell>{ret.item_description}<div className="text-xs text-muted-foreground">{ret.reason || '—'}</div></TableCell>
      <TableCell className="tnum">{ret.qty}</TableCell>
      <TableCell>
        <Select value={ret.inspection_outcome} onValueChange={v => patch({ inspection_outcome: v })} disabled={busy}>
          <SelectTrigger className="h-7 w-28"><SelectValue /></SelectTrigger>
          <SelectContent>
            {['pending', 'accepted', 'rejected'].map(s => <SelectItem key={s} value={s}><Badge variant={{ pending: 'outline', accepted: 'default', rejected: 'destructive' }[s]}>{s}</Badge></SelectItem>)}
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell>
        {ret.inspection_outcome === 'accepted' ? (
          ret.stock_action === 'removed_from_stock' ? (
            <span className="text-xs text-success">Removed from stock — {ret.inventory_description || '—'}</span>
          ) : (
            <div className="flex flex-wrap items-center gap-1.5">
              <Select value={invPick} onValueChange={setInvPick} disabled={busy}>
                <SelectTrigger className="h-7 w-40"><SelectValue placeholder="Inventory item…" /></SelectTrigger>
                <SelectContent>{inventoryItems.map(i => <SelectItem key={i.id} value={String(i.id)}>{i.description}</SelectItem>)}</SelectContent>
              </Select>
              <Button size="sm" variant="outline" disabled={busy || !invPick} onClick={() => patch({ stock_action: 'removed_from_stock', inventory_item_id: invPick })}>Remove from stock</Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => patch({ stock_action: 'replaced' })}>Replaced (no stock change)</Button>
            </div>
          )
        ) : <span className="text-xs text-muted-foreground">{ret.stock_action === 'replaced' ? 'Replaced' : '—'}</span>}
      </TableCell>
      <TableCell>
        <Input value={debitRef} onChange={e => setDebitRef(e.target.value)} onBlur={() => debitRef !== (ret.debit_note_ref || '') && patch({ debit_note_ref: debitRef })}
          placeholder="Debit note #" className="h-7 w-32" disabled={busy} />
      </TableCell>
    </TableRow>
  );
}

function PurchaseReturnsTab({ returns, purchaseOrders, inventoryItems, router }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Purchase Returns</CardTitle>
        <CardAction><Button size="sm" onClick={() => setDialogOpen(true)}><PlusIcon />Raise Return</Button></CardAction>
      </CardHeader>
      <CardContent>
        {returns.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">No returns raised yet.</p> : (
          <Table>
            <TableHeader><TableRow><TableHead>Purchase Order</TableHead><TableHead>Item</TableHead><TableHead>Qty</TableHead><TableHead>Inspection</TableHead><TableHead>Stock action</TableHead><TableHead>Debit note</TableHead></TableRow></TableHeader>
            <TableBody>{returns.map(r => <PurchaseReturnRow key={r.id} ret={r} inventoryItems={inventoryItems} router={router} />)}</TableBody>
          </Table>
        )}
      </CardContent>
      {dialogOpen && <AddPurchaseReturnDialog purchaseOrders={purchaseOrders} router={router} onClose={() => setDialogOpen(false)} />}
    </Card>
  );
}

const SEARCH_PLACEHOLDER = {
  enquiry: 'Search description or project…',
  selection: 'Search description or project…',
  orders: 'Search PO number or supplier…',
  state: 'Search description, project, PO…',
  'suppliers-roster': 'Search supplier name…',
  'suppliers-analysis': 'Search supplier or item…',
  returns: 'Search PO number or item…',
  vendor_bills: 'Search bill number, PO, or supplier…',
};

export default function ProcurementWorkspace({ sourcingItems, suppliers, purchaseOrders, quotes, rfqSummaryByItem = {}, purchaseReturns = [], inventoryItems = [], vendorBills = [], debitNotes = [], tdsRates = [] }) {
  const router = useRouter();
  const [tab, setTab] = useState('enquiry');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [poView, setPoView] = useState('active');
  const [analysisView, setAnalysisView] = useState('dashboard');
  const [projectFilter, setProjectFilter] = useState('all');

  const quotesByItem = {};
  for (const quote of quotes) (quotesByItem[quote.bom_item_id] ||= []).push(quote);
  const activeItems = sourcingItems.filter(it => it.purchase_status !== 'Cancelled');
  const fulfilledCount = purchaseOrders.filter(po => po.fulfilled).length;
  const activeOrderCount = purchaseOrders.length - fulfilledCount;

  // Project list for the Enquiry/Selection filter: NOT plain activeItems (that only drops
  // Cancelled) — a project whose items are all already Ordered/Transit/Received/In-Stock has
  // nothing left for either tab to show, but would still appear, reading as "stuck in
  // Procurement" when it's actually already past it. Match the same OUT_OF_PIPELINE cut both
  // tabs already apply to their own rows, so the dropdown only ever lists a project with real
  // outstanding Enquiry/Selection work.
  const inPipelineItems = useMemo(() => activeItems.filter(it => !OUT_OF_PIPELINE.includes(it.purchase_status)), [activeItems]);
  const bomProjects = useMemo(() => [...new Set(inPipelineItems.map(it => it.project_no))].sort(), [inPipelineItems]);
  const projectItems = projectFilter === 'all' ? activeItems : activeItems.filter(it => it.project_no === projectFilter);

  // Suppliers is one nav item with two sub-views (roster / analysis) instead of two flat tabs —
  // "Suppliers" is the one word for this entity everywhere in the app; a second flat tab called
  // "Vendor Analysis" would read as a different entity. Same SidebarMenuSub pattern the Help
  // page's Notifications entry already uses (WorkspaceSidebar.jsx's `group`/`children`).
  const navItems = [
    { key: 'enquiry', label: 'Enquiry', icon: SearchIcon },
    { key: 'selection', label: 'Selection', icon: GitCompareIcon },
    { key: 'orders', label: 'Purchase Orders', icon: FileTextIcon },
    { key: 'state', label: 'Status', icon: ListChecksIcon },
    { key: 'returns', label: 'Returns', icon: Undo2Icon },
    { key: 'vendor_bills', label: 'Vendor Bills', icon: ReceiptIcon },
    {
      key: 'suppliers', label: 'Suppliers', icon: Building2Icon, group: true,
      children: [
        { key: 'suppliers-roster', label: 'Roster', icon: Building2Icon },
        { key: 'suppliers-analysis', label: 'Analysis', icon: BarChart3Icon },
      ],
    },
  ];

  return (
    <WorkspaceSidebar title="Procurement" icon={ShoppingCartIcon} items={navItems} activeKey={tab} onChange={setTab}>
      {/* One shared search row, same position under the tab bar regardless of which tab is active,
          so switching tabs never makes the page jump (§4, point 4). Each tab interprets it. A
          tab-specific control (Status's status filter, Purchase Orders' Active/Fulfilled toggle)
          sits right-aligned in the same row rather than adding a second control row per tab. */}
      <div className="flex flex-wrap items-center gap-2">
        <Input value={search} onChange={e => setSearch(e.target.value)}
          placeholder={SEARCH_PLACEHOLDER[tab]} className="h-8 w-72" />
        {(tab === 'enquiry' || tab === 'selection') && bomProjects.length > 0 && (
          <Select value={projectFilter} onValueChange={setProjectFilter}>
            <SelectTrigger className="ml-auto h-8 w-44"><SelectValue placeholder="All projects" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All projects</SelectItem>
              {bomProjects.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
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
        {tab === 'suppliers-analysis' && (
          <div className="ml-auto flex gap-1 rounded-md border p-0.5">
            <Button size="sm" variant={analysisView === 'dashboard' ? 'secondary' : 'ghost'} className="h-7 px-2.5 text-xs"
              onClick={() => setAnalysisView('dashboard')}><LayoutDashboardIcon />Dashboard</Button>
            <Button size="sm" variant={analysisView === 'supplier' ? 'secondary' : 'ghost'} className="h-7 px-2.5 text-xs"
              onClick={() => setAnalysisView('supplier')}>By Supplier</Button>
            <Button size="sm" variant={analysisView === 'item' ? 'secondary' : 'ghost'} className="h-7 px-2.5 text-xs"
              onClick={() => setAnalysisView('item')}>By Item</Button>
          </div>
        )}
      </div>
      {tab === 'enquiry' && <Enquiry items={projectItems} quotesByItem={quotesByItem} suppliers={suppliers} rfqSummaryByItem={rfqSummaryByItem} router={router} q={search} />}
      {tab === 'selection' && <Selection items={projectItems} quotesByItem={quotesByItem} router={router} q={search} />}
      {tab === 'orders' && <PurchaseOrders orders={purchaseOrders} q={search} view={poView} suppliers={suppliers} tdsRates={tdsRates} />}
      {tab === 'state' && <State items={sourcingItems} router={router} q={search} statusFilter={statusFilter} />}
      {tab === 'suppliers-roster' && <Suppliers suppliers={suppliers} quotes={quotes} q={search} />}
      {tab === 'suppliers-analysis' && <SupplierAnalysis view={analysisView} suppliers={suppliers} quotes={quotes} purchaseOrders={purchaseOrders} q={search} />}
      {tab === 'returns' && (
        <PurchaseReturnsTab
          returns={purchaseReturns.filter(r => !search.trim() || [r.po_no, r.item_description, r.supplier_name].some(v => (v || '').toLowerCase().includes(search.trim().toLowerCase())))}
          purchaseOrders={purchaseOrders} inventoryItems={inventoryItems} router={router}
        />
      )}
      {tab === 'vendor_bills' && (
        <VendorBillsTab
          vendorBills={vendorBills.filter(vb => !search.trim() || [vb.bill_no, vb.po_no, vb.supplier_name].some(v => (v || '').toLowerCase().includes(search.trim().toLowerCase())))}
          debitNotes={debitNotes} router={router}
        />
      )}
    </WorkspaceSidebar>
  );
}
