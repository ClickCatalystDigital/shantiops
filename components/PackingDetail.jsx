'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, showToast, formatDate } from '@/lib/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Trash2Icon, FileTextIcon, CheckCircle2Icon, CircleAlertIcon, SearchIcon, ChevronDownIcon } from 'lucide-react';
import { COMPANY_NAMES } from '@/lib/company-profiles';
import { EntityCode } from '@/components/EntityRefLink';
import { groupForms } from '@/lib/packing-forms.mjs';
import PackingCombined from '@/components/PackingCombined';

// Click-to-edit cell: saves on blur/Enter through PATCH /api/packing/[id]/items.
function EditCell({ value, onSave, disabled, className = '' }) {
  const [v, setV] = useState(value ?? '');
  useEffect(() => setV(value ?? ''), [value]);
  if (disabled) return <span>{value || '—'}</span>;
  return <Input className={`h-7 min-w-16 px-1.5 text-xs ${className}`} value={v} placeholder="—" onChange={e => setV(e.target.value)}
    onBlur={() => { if ((v || '') !== (value || '')) onSave(v); }} onKeyDown={e => e.key === 'Enter' && e.currentTarget.blur()} />;
}

const BLANK = { material_description: '', moc: '', size_spec: '', ibr_no: '', box_no: '', qty: 1, make: '', item_code: '' };
const STATUSES = ['draft', 'packed', 'dispatched'];

const HEADER_FIELDS = [
  ['customer_name', 'Customer', 'text'], ['customer_address', 'Address', 'text'],
  ['contact_person', 'Contact Person / No', 'text'], ['package_type', 'Package Type', 'text'],
  ['invoice_no', 'Invoice No', 'text'], ['invoice_date', 'Invoice Date', 'date'],
  ['dc_no', 'D.C. No', 'text'], ['dc_date', 'D.C. Date', 'date'],
  ['dispatch_through', 'Dispatch Through', 'text'], ['vehicle_no', 'Vehicle No', 'text'],
  ['eway_bill_no', 'E-Way Bill No', 'text'], ['eway_bill_date', 'E-Way Bill Date', 'date'],
];
const FREIGHT_PAID_BY = [['us', 'We pay'], ['customer', 'Customer pays']];
// NIC's own cancellation reason codes (docs.ewaybillgst.gov.in, confirmed live).
const CANCEL_REASONS = [[1, 'Duplicate'], [2, 'Order Cancelled'], [3, 'Data Entry Mistake'], [4, 'Others']];
// E-way bill prerequisites (real-NIC-API research plan) — transport mode/vehicle type must be an
// explicit Dispatch choice, never a silent backend default; the Select below pre-selects the
// overwhelmingly common case (Road / Regular) but Dispatch always sees and can change it.
const TRANSPORT_MODES = [['road', 'Road'], ['rail', 'Rail'], ['air', 'Air'], ['ship', 'Ship']];
const VEHICLE_TYPES = [['regular', 'Regular'], ['odc', 'Over Dimensional Cargo']];
// discrepancy, not 'partial' (Feature D) — deliberately distinct from the pre-existing multi-
// packing-list partial-delivery concept (a project's own pending-items tracking); this is about
// THIS shipment's own contents, e.g. "ordered 10, received 8," not "more is coming later."
const DELIVERY_ACK_STATUSES = [['accepted', 'Accepted'], ['damaged', 'Damaged'], ['discrepancy', 'Discrepancy']];

// Delivery acknowledgment (Feature D) — captured once, by Dispatch, after the customer confirms
// receipt by phone/email. Immutable after first capture: once list.delivery_ack_status is set, this
// card only ever displays it, never offers an edit path (a correction goes through a fresh
// manual/admin note, matching the freight card's own "correct elsewhere, not here" precedent).
function DeliveryAckCard({ list, onDone }) {
  const [status, setStatus] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!status) return showToast('Choose accepted, damaged, or discrepancy', 'error');
    setBusy(true);
    try {
      const saved = await api(`/api/packing/${list.id}/acknowledge`, { method: 'POST', body: { status, notes } });
      onDone({
        delivery_ack_status: saved.delivery_ack_status,
        delivery_ack_notes: saved.delivery_ack_notes,
        delivery_ack_at: saved.delivery_ack_at,
        delivery_ack_by: saved.delivery_ack_by,
      });
      showToast('Delivery acknowledgment logged');
    } catch (err) { showToast(err.message, 'error'); }
    setBusy(false);
  }

  return (
    <Card className="no-print">
      <CardContent className="flex flex-col gap-3 py-4">
        <p className="text-sm font-medium">Delivery acknowledgment</p>
        {list.delivery_ack_status ? (
          <div className="text-sm">
            <Badge variant={list.delivery_ack_status === 'accepted' ? 'default' : 'destructive'}>
              {DELIVERY_ACK_STATUSES.find(([v]) => v === list.delivery_ack_status)?.[1] || list.delivery_ack_status}
            </Badge>
            <p className="mt-1 text-xs text-muted-foreground">
              {formatDate(list.delivery_ack_at)} · {list.delivery_ack_by}
            </p>
            {list.delivery_ack_notes && <p className="mt-1 text-xs">{list.delivery_ack_notes}</p>}
          </div>
        ) : (
          <>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-56"><SelectValue placeholder="Choose an outcome" /></SelectTrigger>
              <SelectContent>{DELIVERY_ACK_STATUSES.map(([v, label]) => <SelectItem key={v} value={v}>{label}</SelectItem>)}</SelectContent>
            </Select>
            <Textarea placeholder="Notes (optional)" value={notes} onChange={e => setNotes(e.target.value)} rows={2} />
            <Button size="sm" className="w-fit" disabled={busy} onClick={submit}>
              {busy ? 'Logging…' : 'Log acknowledgment'}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// Only issued/paid invoices can back an e-way bill. A draft that is already linked stays listed so it
// can be seen (and replaced), rather than silently vanishing from the picker.
function usableInvoices(invoices, linkedId) {
  return invoices.filter(i => ['issued', 'paid'].includes(i.status) || i.id === linkedId);
}

// The e-way bill card: a live tick-list of what NIC needs, with the things Dispatch can fix on this
// list editable right here (they save immediately). Server-side the same list refuses generation, so
// the card and the button can never disagree (GET/POST /api/packing/[id]/eway-bill).
function EwayChecklistCard({ list, setList, invoices, onGenerate, generating }) {
  const [checks, setChecks] = useState(null);
  const reload = () => api(`/api/packing/${list.id}/eway-bill`).then(r => setChecks(r.checks)).catch(() => setChecks([]));
  useEffect(() => { reload(); }, [list.id]);

  async function save(patch) {
    try {
      await api(`/api/packing/${list.id}`, { method: 'PATCH', body: patch });
      setList(l => ({ ...l, ...patch }));
      await reload();
    } catch (err) { showToast(err.message, 'error'); }
  }
  const [dist, setDist] = useState(list.transport_distance_km ?? '');
  const [open, setOpen] = useState(false);
  const hereOk = (checks || []).filter(c => c.where === 'here').every(c => c.ok);
  const blocker = (checks || []).find(c => !c.ok);
  const okCount = (checks || []).filter(c => c.ok).length;

  return (
    <Card className="no-print">
      <CardContent className="flex flex-col gap-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button type="button" onClick={() => setOpen(v => !v)} className="flex items-center gap-2 text-left">
            <ChevronDownIcon className={`size-4 text-muted-foreground transition-transform ${open ? '' : '-rotate-90'}`} />
            <span>
              <span className="block text-sm font-medium">E-way bill</span>
              <span className="block text-xs text-muted-foreground">{checks === null ? 'Checking…' : blocker ? `Not generated · ${okCount} of ${checks.length} requirements ready` : 'Ready to generate'}</span>
            </span>
          </button>
          <Button size="sm" variant={blocker ? 'outline' : 'default'} disabled={generating || !checks || !!blocker} onClick={onGenerate}>{generating ? 'Generating…' : 'Generate'}</Button>
        </div>

        {open && <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Distance (km)</Label>
            <Input type="number" min="1" max="4000" value={dist} onChange={e => setDist(e.target.value)}
              onBlur={() => { if (String(dist) !== String(list.transport_distance_km ?? '')) save({ transport_distance_km: dist || '' }); }} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Transport mode</Label>
            <Select value={list.transport_mode || ''} onValueChange={v => save({ transport_mode: v })}>
              <SelectTrigger><SelectValue placeholder="Choose" /></SelectTrigger>
              <SelectContent>{TRANSPORT_MODES.map(([v, label]) => <SelectItem key={v} value={v}>{label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Vehicle type</Label>
            <Select value={list.vehicle_type || ''} onValueChange={v => save({ vehicle_type: v })}>
              <SelectTrigger><SelectValue placeholder="Choose" /></SelectTrigger>
              <SelectContent>{VEHICLE_TYPES.map(([v, label]) => <SelectItem key={v} value={v}>{label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Sales invoice</Label>
            <Select value={list.sales_invoice_id ? String(list.sales_invoice_id) : ''} onValueChange={v => save({ sales_invoice_id: Number(v) })}>
              <SelectTrigger><SelectValue placeholder="Choose" /></SelectTrigger>
              <SelectContent>
                {usableInvoices(invoices, list.sales_invoice_id).map(i => <SelectItem key={i.id} value={String(i.id)}>{i.invoice_no}{['issued', 'paid'].includes(i.status) ? '' : ' (draft)'}</SelectItem>)}
                {!usableInvoices(invoices, list.sales_invoice_id).length && <SelectItem value="none" disabled>No issued invoices for this project</SelectItem>}
              </SelectContent>
            </Select>
          </div>
        </div>}

        {open && <ul className="flex flex-col gap-1.5 text-sm">
          {checks === null && <li className="text-xs text-muted-foreground">Checking…</li>}
          {(checks || []).map(c => (
            <li key={c.key} className="flex items-start gap-2">
              {c.ok ? <CheckCircle2Icon className="mt-0.5 size-4 shrink-0 text-success" /> : <CircleAlertIcon className="mt-0.5 size-4 shrink-0 text-warning" />}
              <span>
                <span className={c.ok ? 'text-muted-foreground' : 'font-medium'}>{c.label}</span>
                {!c.ok && <span className="block text-xs text-muted-foreground">{c.fix}{c.where === 'admin' ? ' (not something Dispatch can fix here)' : ''}</span>}
              </span>
            </li>
          ))}
        </ul>}
        {open && checks && hereOk && blocker && <p className="text-xs text-muted-foreground">Everything on this list is ready. The remaining item above needs Accounts or your technical team.</p>}
      </CardContent>
    </Card>
  );
}

// Add a line to this list from somewhere other than typing: a still-pending BOM line of this
// project (even one that hasn't arrived yet) or an Item Master catalogue item.
function AddFromDialog({ open, onOpenChange, list, onAdded }) {
  const [tab, setTab] = useState('bom');
  const [pending, setPending] = useState(null);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || pending) return;
    api(`/api/packing/${list.id}/pending`).then(setPending).catch(err => { showToast(err.message, 'error'); setPending([]); });
  }, [open]);
  useEffect(() => {
    if (tab !== 'catalogue' || q.trim().length < 2) { setHits([]); return; }
    const t = setTimeout(() => api(`/api/items?search=${encodeURIComponent(q.trim())}`).then(setHits).catch(() => setHits([])), 250);
    return () => clearTimeout(t);
  }, [q, tab]);

  async function add(body, done) {
    setBusy(true);
    try { const r = await api(`/api/packing/${list.id}/items`, { method: 'POST', body }); onAdded(r, body); done?.(); }
    catch (err) { showToast(err.message, 'error'); }
    setBusy(false);
  }
  const needle = q.trim().toLowerCase();
  const bomRows = (pending || []).filter(it => !needle || `${it.material_description} ${it.size_spec || ''}`.toLowerCase().includes(needle));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader><DialogTitle>Add item to {list.packing_no}</DialogTitle></DialogHeader>
        <div className="inline-flex w-fit rounded-full border bg-muted/50 p-0.5 text-sm">
          {[['bom', 'Project BOM (pending)'], ['catalogue', 'Item catalogue']].map(([k, label]) => (
            <button key={k} type="button" onClick={() => { setTab(k); setQ(''); }}
              className={`rounded-full px-3 py-1 transition-colors ${tab === k ? 'bg-card font-medium shadow-sm' : 'text-muted-foreground'}`}>{label}</button>
          ))}
        </div>
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={e => setQ(e.target.value)} className="pl-9" placeholder={tab === 'bom' ? 'Filter pending lines…' : 'Search the Item Master (2+ letters)…'} />
        </div>
        <div className="max-h-80 overflow-y-auto rounded-md border">
          {tab === 'bom' && (pending === null ? <p className="p-4 text-sm text-muted-foreground">Loading…</p>
            : !list.project_id ? <p className="p-4 text-sm text-muted-foreground">This list has no project, so it has no BOM lines. Use the catalogue.</p>
            : bomRows.length === 0 ? <p className="p-4 text-sm text-muted-foreground">No pending lines for this project.</p>
            : bomRows.map(it => (
              <div key={it.id} className="flex items-center gap-3 border-b px-3 py-2 text-sm last:border-b-0">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{it.material_description}</div>
                  <div className="text-xs text-muted-foreground">{[it.qty_text, it.size_spec].filter(Boolean).join(' · ') || '—'}</div>
                </div>
                {it.readyForPacking
                  ? <Badge variant="outline" className="border-success/30 bg-success-surface text-success">Ready</Badge>
                  : <Badge variant="outline" className="text-muted-foreground">Not received yet</Badge>}
                <Button size="sm" disabled={busy} onClick={() => {
                  if (!it.readyForPacking && !confirm('This item has not been received/produced yet. Add it anyway?')) return;
                  add({ bom_item_id: it.id, material_description: it.material_description }, () => setPending(p => p.filter(x => x.id !== it.id)));
                }}>Add</Button>
              </div>
            )))}
          {tab === 'catalogue' && (q.trim().length < 2 ? <p className="p-4 text-sm text-muted-foreground">Type at least 2 letters.</p>
            : hits.length === 0 ? <p className="p-4 text-sm text-muted-foreground">No catalogue item matches.</p>
            : hits.map(h => (
              <div key={h.id} className="flex items-center gap-3 border-b px-3 py-2 text-sm last:border-b-0">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{h.item_name}</div>
                  <div className="text-xs text-muted-foreground">{[h.item_code, h.default_moc, h.uom].filter(Boolean).join(' · ')}</div>
                </div>
                <Button size="sm" disabled={busy} onClick={() => add({ material_description: h.item_name, moc: h.default_moc || '', item_code: h.item_code || '', unit: h.uom || undefined, qty: 1 })}>Add</Button>
              </div>
            )))}
        </div>
        <DialogFooter><Button variant="ghost" onClick={() => onOpenChange(false)}>Done</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function PackingDetail({ list: initialList, items: initialItems, checklist: initialChecklist = [], readOnly = false }) {
  const [checklist, setChecklist] = useState(initialChecklist);
  // forms derive from items below; declared after items state
  const [newCheck, setNewCheck] = useState('');
  const router = useRouter();
  const [list, setList] = useState(initialList);
  const [items, setItems] = useState(initialItems);
  const forms = groupForms(items, list.master_section);
  const [f, setF] = useState(BLANK);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initialList);
  const [invoices, setInvoices] = useState([]);
  const [postingFreight, setPostingFreight] = useState(false);
  const [generatingEwayBill, setGeneratingEwayBill] = useState(false);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [cancellingEwayBill, setCancellingEwayBill] = useState(false);
  const [cancelReasonCode, setCancelReasonCode] = useState('');
  const [cancelRemark, setCancelRemark] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [addFromOpen, setAddFromOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);

  useEffect(() => {
    if (!list.project_id) return;
    api(`/api/sales-invoices?project_id=${list.project_id}`).then(setInvoices).catch(() => {});
  }, [list.project_id]);

  async function addItem(e) {
    e.preventDefault();
    if (!f.material_description.trim()) return;
    try {
      const r = await api(`/api/packing/${list.id}/items`, { method: 'POST', body: f });
      // A combined list is renumbered/grouped by the server, so take its returned lines as they are.
      setItems(xs => r.items || [...xs, { ...f, id: r.id, s_no: xs.length + 1, qty: Number(f.qty) || 1, unit: "No's" }]);
      setF(BLANK);
    } catch (err) { showToast(err.message, 'error'); }
  }
  async function removeItem(id) {
    try { const r = await api(`/api/packing/${list.id}/items?itemId=${id}`, { method: 'DELETE' }); setItems(xs => r.items || xs.filter(x => x.id !== id)); }
    catch (err) { showToast(err.message, 'error'); }
  }
  async function saveItem(id, patch) {
    try {
      await api(`/api/packing/${list.id}/items`, { method: 'PATCH', body: { itemId: id, ...patch } });
      setItems(xs => xs.map(x => x.id === id ? { ...x, ...patch } : x));
    } catch (err) { showToast(err.message, 'error'); }
  }
  async function addCheck() {
    if (!newCheck.trim()) return;
    try { const r = await api(`/api/packing/${list.id}/checklist`, { method: 'POST', body: { description: newCheck } });
      setChecklist(c => [...c, { id: r.id, description: newCheck.trim(), prod_ok: 0, qc_ok: 0, stores_ok: 0 }]); setNewCheck(''); }
    catch (err) { showToast(err.message, 'error'); }
  }
  async function tickCheck(id, k, v) {
    setChecklist(c => c.map(x => x.id === id ? { ...x, [k]: v ? 1 : 0 } : x));
    try { await api(`/api/packing/${list.id}/checklist`, { method: 'PATCH', body: { itemId: id, [k]: v } }); }
    catch (err) { showToast(err.message, 'error'); setChecklist(c => c.map(x => x.id === id ? { ...x, [k]: v ? 0 : 1 } : x)); }
  }
  async function removeCheck(id) {
    try { await api(`/api/packing/${list.id}/checklist?itemId=${id}`, { method: 'DELETE' }); setChecklist(c => c.filter(x => x.id !== id)); }
    catch (err) { showToast(err.message, 'error'); }
  }
  async function setMaster(name) {
    try { await api(`/api/packing/${list.id}`, { method: 'PATCH', body: { master_section: name } }); setList(l => ({ ...l, master_section: name })); }
    catch (err) { showToast(err.message, 'error'); }
  }
  async function changeStatus(v) {
    const prev = list.status;
    setList(l => ({ ...l, status: v }));
    try { await api(`/api/packing/${list.id}`, { method: 'PATCH', body: { status: v } }); }
    catch (err) { showToast(err.message, 'error'); setList(l => ({ ...l, status: prev })); }
  }
  async function saveHeader(e) {
    e.preventDefault();
    const body = {
      freight_paid_by: draft.freight_paid_by || '', sales_invoice_id: draft.sales_invoice_id || '',
      transport_distance_km: draft.transport_distance_km || '',
      transport_mode: draft.transport_mode || '', vehicle_type: draft.vehicle_type || '',
    };
    if (draft.company) body.company = draft.company;
    HEADER_FIELDS.forEach(([k]) => { body[k] = draft[k] || ''; });
    // Once posted, freight_amount is read-only (disabled input above) — leave it out of the body
    // entirely rather than resending the unchanged figure, which would otherwise trip the server's
    // own already-posted guard and block every OTHER field in this same save.
    if (list.freightPosted) delete body.freight_amount;
    try { await api(`/api/packing/${list.id}`, { method: 'PATCH', body }); setList(l => ({ ...l, ...body })); setEditing(false); showToast('Details saved'); }
    catch (err) { showToast(err.message, 'error'); }
  }
  async function deleteList() {
    if (!confirm(`Delete ${list.status === 'packed' ? 'ready list' : 'draft'} ${list.packing_no}? This removes all ${items.length} item${items.length === 1 ? '' : 's'} from it${list.status === 'packed' ? ' and any pre-dispatch review on it' : ''} — the underlying BOM lines go back to Pending and can be put on a new list.`)) return;
    setDeleting(true);
    try {
      await api(`/api/packing/${list.id}`, { method: 'DELETE' });
      showToast('Packing list deleted');
      router.push('/dispatch');
    } catch (err) { showToast(err.message, 'error'); setDeleting(false); }
  }
  async function postFreight() {
    setPostingFreight(true);
    try {
      await api(`/api/packing/${list.id}/freight`, { method: 'POST' });
      setList(l => ({ ...l, freightPosted: true }));
      showToast('Freight expense posted to the ledger');
    } catch (err) { showToast(err.message, 'error'); }
    finally { setPostingFreight(false); }
  }
  async function generateEwayBill() {
    setGeneratingEwayBill(true);
    try {
      const res = await api(`/api/packing/${list.id}/eway-bill`, { method: 'POST' });
      setList(l => ({ ...l, eway_bill_no: res.ewayBillNo, eway_bill_date: res.date, eway_bill_valid_upto: res.validUpto }));
      showToast('E-way bill generated');
    } catch (err) { showToast(err.message, 'error'); }
    finally { setGeneratingEwayBill(false); }
  }
  async function submitCancelEwayBill() {
    if (!cancelReasonCode) { showToast('Choose a cancellation reason', 'error'); return; }
    if (!cancelRemark.trim()) { showToast('Enter a short remark', 'error'); return; }
    setCancellingEwayBill(true);
    try {
      await api(`/api/packing/${list.id}/eway-bill/cancel`, { method: 'POST', body: { cancelRsnCode: Number(cancelReasonCode), cancelRmrk: cancelRemark.trim() } });
      setList(l => ({ ...l, eway_bill_no: null, eway_bill_date: null, eway_bill_valid_upto: null }));
      setCancelDialogOpen(false);
      setCancelReasonCode('');
      setCancelRemark('');
      showToast('E-way bill cancelled');
    } catch (err) { showToast(err.message, 'error'); }
    finally { setCancellingEwayBill(false); }
  }
  // NIC only allows cancellation within 24 hours of generation — computed client-side too, so the
  // Cancel button doesn't invite an attempt the server will reject anyway.
  const ewayBillCancellable = list.eway_bill_date && (Date.now() - new Date(list.eway_bill_date).getTime()) <= 24 * 60 * 60 * 1000;

  const Meta = ({ label, value }) => (
    <div><dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</dt><dd className="text-sm font-medium">{value || <span className="text-muted-foreground/40">—</span>}</dd></div>
  );

  const linkedInvoice = invoices.find(i => i.id === list.sales_invoice_id);

  return (
    <main className="container flex flex-col gap-6 py-8">
      <div className="flex flex-wrap items-start justify-between gap-3 no-print">
        <div>
          <h1 className="text-2xl font-bold tracking-tight tnum">
            {list.packing_no}
            {list.projectListCount > 1 && <span className="ml-2 align-middle text-sm font-medium text-muted-foreground">List {list.projectListNo} of {list.projectListCount}{list.project_no ? ` for ${list.project_no}` : ''}</span>}
          </h1>
          <p className="text-sm text-muted-foreground">{list.customer_name}{list.invoice_no ? ` · Invoice ${list.invoice_no}` : ''}</p>
          {list.bom_release_revision_at_creation != null && (
            <p className="text-xs text-muted-foreground">
              BOM rev {list.bom_release_revision_at_creation}
              {list.bomRevisionDrift && <span className="text-warning"> — master's BOM has since moved to rev {list.masterBomRevision}</span>}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!readOnly && (
            <Select value={list.status} onValueChange={changeStatus}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>{STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          )}
          {!readOnly && <Button variant="outline" size="sm" onClick={() => { setDraft(list); setEditing(v => !v); }}>{editing ? 'Close' : 'Edit details'}</Button>}
          {!readOnly && ['draft', 'packed'].includes(list.status) && (
            <Button variant="outline" size="sm" className="text-danger hover:text-danger" disabled={deleting} onClick={deleteList}>
              <Trash2Icon data-icon="inline-start" />{deleting ? 'Deleting…' : 'Delete list'}
            </Button>
          )}
          <Button asChild size="sm"><a href={`/api/packing/${list.id}/pdf`} target="_blank" rel="noreferrer"><FileTextIcon data-icon="inline-start" />{forms.length > 1 ? 'All forms PDF' : 'Generate PDF'}</a></Button>
          {!readOnly && <Button asChild variant="ghost" size="sm"><Link href="/dispatch">← All</Link></Button>}
        </div>
      </div>

      {!readOnly && editing && (
        <Card className="no-print">
          <CardContent className="py-5">
            <form onSubmit={saveHeader} className="flex flex-col gap-4">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {HEADER_FIELDS.map(([k, label, type]) => (
                  <div key={k} className="flex flex-col gap-1.5">
                    <Label>{label}</Label>
                    <Input type={type} value={draft[k] || ''} onChange={e => setDraft({ ...draft, [k]: e.target.value })} />
                  </div>
                ))}
                <div className="flex flex-col gap-1.5">
                  <Label>Linked Invoice</Label>
                  <Select value={draft.sales_invoice_id ? String(draft.sales_invoice_id) : ''} onValueChange={v => setDraft({ ...draft, sales_invoice_id: Number(v) })}>
                    <SelectTrigger><SelectValue placeholder="Not linked" /></SelectTrigger>
                    <SelectContent>
                      {usableInvoices(invoices, draft.sales_invoice_id).map(i => <SelectItem key={i.id} value={String(i.id)}>{i.invoice_no} · {i.total}{['issued', 'paid'].includes(i.status) ? '' : ' (draft)'}</SelectItem>)}
                      {!usableInvoices(invoices, draft.sales_invoice_id).length && <SelectItem value="none" disabled>No issued invoices for this project</SelectItem>}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Company</Label>
                  <Select value={draft.company || ''} onValueChange={v => setDraft({ ...draft, company: v })}>
                    <SelectTrigger><SelectValue placeholder="Choose" /></SelectTrigger>
                    <SelectContent>{COMPANY_NAMES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Freight Amount</Label>
                  <Input type="number" min="0" step="any" disabled={!!list.freightPosted}
                    value={draft.freight_amount || ''} onChange={e => setDraft({ ...draft, freight_amount: e.target.value })} />
                  {list.freightPosted && <p className="text-xs text-muted-foreground">Already posted — correct via a manual Journal Entry in Accounts, not here.</p>}
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Freight Paid By</Label>
                  <Select value={draft.freight_paid_by || ''} onValueChange={v => setDraft({ ...draft, freight_paid_by: v })}>
                    <SelectTrigger><SelectValue placeholder="Not set" /></SelectTrigger>
                    <SelectContent>{FREIGHT_PAID_BY.map(([v, label]) => <SelectItem key={v} value={v}>{label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Transport Distance (km)</Label>
                  <Input type="number" min="0" max="4000" step="1"
                    value={draft.transport_distance_km || ''} onChange={e => setDraft({ ...draft, transport_distance_km: e.target.value })} />
                  <p className="text-xs text-muted-foreground">Required to generate an e-way bill. NIC's own max is 4000 km.</p>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Transport Mode</Label>
                  <Select value={draft.transport_mode || 'road'} onValueChange={v => setDraft({ ...draft, transport_mode: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{TRANSPORT_MODES.map(([v, label]) => <SelectItem key={v} value={v}>{label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Vehicle Type</Label>
                  <Select value={draft.vehicle_type || 'regular'} onValueChange={v => setDraft({ ...draft, vehicle_type: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{VEHICLE_TYPES.map(([v, label]) => <SelectItem key={v} value={v}>{label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              <div><Button type="submit">Save</Button></div>
            </form>
          </CardContent>
        </Card>
      )}

      {!readOnly && list.freight_amount > 0 && list.freight_paid_by === 'us' && (
        <Card className="no-print">
          <CardContent className="flex items-center justify-between py-4">
            <div>
              <p className="text-sm font-medium">Freight expense: {list.freight_amount}</p>
              <p className="text-xs text-muted-foreground">{list.freightPosted ? 'Posted to the ledger.' : 'Not yet posted to the ledger.'}</p>
            </div>
            {!list.freightPosted && <Button size="sm" disabled={postingFreight} onClick={postFreight}>{postingFreight ? 'Posting…' : 'Post Freight Expense'}</Button>}
          </CardContent>
        </Card>
      )}

      {!readOnly && !list.eway_bill_no && (
        <EwayChecklistCard list={list} setList={setList} invoices={invoices} onGenerate={generateEwayBill} generating={generatingEwayBill} />
      )}

      {list.eway_bill_no && (
        <Card className="no-print">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
            <div className="flex flex-wrap gap-x-8 gap-y-1">
              <div><dt className="text-xs text-muted-foreground">E-Way Bill No</dt><dd className="text-sm font-medium tnum">{list.eway_bill_no}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Generated</dt><dd className="text-sm font-medium">{list.eway_bill_date ? formatDate(list.eway_bill_date) : '—'}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Valid Until</dt><dd className="text-sm font-medium">{list.eway_bill_valid_upto ? formatDate(list.eway_bill_valid_upto) : '—'}</dd></div>
            </div>
            {!readOnly && (
              ewayBillCancellable
                ? <Button size="sm" variant="outline" className="text-danger hover:text-danger" onClick={() => setCancelDialogOpen(true)}>Cancel E-Way Bill</Button>
                : <p className="text-xs text-muted-foreground">Past NIC's 24-hour cancellation window.</p>
            )}
          </CardContent>
        </Card>
      )}

      <Dialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Cancel E-Way Bill {list.eway_bill_no}</DialogTitle></DialogHeader>
          <div className="flex flex-col gap-4 text-sm">
            <p className="text-muted-foreground">This cancels the real e-way bill with NIC — it can’t be undone, and only works within 24 hours of generation.</p>
            <div className="flex flex-col gap-1.5">
              <Label>Reason</Label>
              <Select value={cancelReasonCode} onValueChange={setCancelReasonCode}>
                <SelectTrigger><SelectValue placeholder="Choose a reason" /></SelectTrigger>
                <SelectContent>{CANCEL_REASONS.map(([v, label]) => <SelectItem key={v} value={String(v)}>{label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Remark</Label>
              <Textarea value={cancelRemark} onChange={e => setCancelRemark(e.target.value)} placeholder="Short explanation for the cancellation" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCancelDialogOpen(false)}>Close</Button>
            <Button variant="destructive" disabled={cancellingEwayBill} onClick={submitCancelEwayBill}>{cancellingEwayBill ? 'Cancelling…' : 'Cancel E-Way Bill'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {!readOnly && list.status === 'dispatched' && (
        <DeliveryAckCard list={list} onDone={updated => setList(l => ({ ...l, ...updated }))} />
      )}

      {/* Printable document */}
      <Card>
        <CardContent className="py-6">
          <div className="mb-4 text-center">
            <div className="text-lg font-extrabold tracking-tight">SHANTI BOILERS &amp; PRESSURE VESSELS PVT LTD</div>
            <div className="text-xs text-muted-foreground">P-10-10, I.D.A, Nacharam, Hyderabad - 500 056 · Stores@shantiboilers.com</div>
            <div className="mt-1.5 text-sm font-bold">MASTER PACKING LIST</div>
          </div>

          <dl className="mb-6 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-4">
            <Meta label="Buyer" value={list.customer_name} />
            <Meta label="Packing No" value={list.packing_no} />
            <Meta label="Address" value={list.customer_address} />
            <Meta label="Package Type" value={list.package_type} />
            <Meta label="Invoice No" value={list.sales_invoice_id
              ? <EntityCode code={`SI-${list.sales_invoice_id}`} fallback={linkedInvoice?.invoice_no || list.invoice_no} />
              : list.invoice_no} />
            <Meta label="Invoice Date" value={list.invoice_date && formatDate(list.invoice_date)} />
            <Meta label="D.C. No" value={list.dc_no} />
            <Meta label="D.C. Date" value={list.dc_date && formatDate(list.dc_date)} />
            <Meta label="Dispatch Through" value={list.dispatch_through} />
            <Meta label="Vehicle No" value={list.vehicle_no} />
            <Meta label="E-Way Bill No" value={list.eway_bill_no} />
            <Meta label="E-Way Bill Date" value={list.eway_bill_date && formatDate(list.eway_bill_date)} />
          </dl>

          {list.layout === 'combined' ? (
            <PackingCombined list={list} items={items} setItems={setItems} saveItem={saveItem} removeItem={removeItem} readOnly={readOnly} />
          ) : forms.map(f => (
            <div key={f.name} className="mb-6">
              {forms.length > 1 || f.name !== 'Other' ? (
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold">{f.name}</h3>
                  <Badge variant={f.kind === 'master' ? 'default' : 'secondary'}>{f.kind === 'master' ? 'Master' : 'Annexure'}</Badge>
                  {!readOnly && f.kind !== 'master' && <Button variant="ghost" size="sm" className="no-print h-6 text-xs" onClick={() => setMaster(f.raw)}>Make master</Button>}
                  <Button asChild variant="ghost" size="sm" className="no-print h-6 text-xs"><a href={`/api/packing/${list.id}/pdf?form=${encodeURIComponent(f.name)}`} target="_blank" rel="noreferrer"><FileTextIcon data-icon="inline-start" />PDF</a></Button>
                </div>
              ) : null}
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>#</TableHead><TableHead>Description</TableHead><TableHead>MOC</TableHead><TableHead>Size / Spec</TableHead>
                      <TableHead>IBR No</TableHead><TableHead>Item Code</TableHead><TableHead>Package</TableHead><TableHead>Qty</TableHead><TableHead>Make</TableHead>
                      {!readOnly && <TableHead className="no-print" />}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {f.items.map(it => (
                      <TableRow key={it.id}>
                        <TableCell className="tnum">{it.s_no}</TableCell>
                        <TableCell className="font-medium">{it.material_description}</TableCell>
                        <TableCell>{it.moc || '—'}</TableCell>
                        <TableCell>{it.size_spec || '—'}</TableCell>
                        <TableCell><EditCell value={it.ibr_no} disabled={readOnly} onSave={v => saveItem(it.id, { ibr_no: v })} /></TableCell>
                        <TableCell><EditCell value={it.item_code} disabled={readOnly} onSave={v => saveItem(it.id, { item_code: v })} /></TableCell>
                        <TableCell><EditCell value={it.box_no} disabled={readOnly} className="min-w-24" onSave={v => saveItem(it.id, { box_no: v })} /></TableCell>
                        <TableCell className="tnum">
                          {it.qty} {it.unit}
                          {it.qty_breakdown && <div className="text-xs font-normal text-muted-foreground">{it.qty_breakdown.label}</div>}
                        </TableCell>
                        <TableCell>{it.make || '—'}</TableCell>
                        {!readOnly && (
                          <TableCell className="no-print">
                            <Button variant="ghost" size="icon-sm" onClick={() => removeItem(it.id)}><Trash2Icon className="text-danger" /></Button>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          ))}
          {items.length === 0 && <p className="text-sm text-muted-foreground">No items yet.</p>}

          {(checklist.length > 0 || !readOnly) && (
            <div className="mb-4">
              <h3 className="mb-2 text-sm font-semibold">Checklist</h3>
              <Table>
                <TableBody>
                  {checklist.map((c, i) => (
                    <TableRow key={c.id}>
                      <TableCell className="tnum w-8">{i + 1}</TableCell>
                      <TableCell>{c.description}</TableCell>
                      {[['prod_ok', 'Prod'], ['qc_ok', 'QC'], ['stores_ok', 'Stores']].map(([k, label]) => (
                        <TableCell key={k} className="w-20">
                          <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={!!c[k]} onChange={e => tickCheck(c.id, k, e.target.checked)} />{label}</label>
                        </TableCell>
                      ))}
                      {!readOnly && <TableCell className="no-print w-8"><Button variant="ghost" size="icon-sm" onClick={() => removeCheck(c.id)}><Trash2Icon className="text-danger" /></Button></TableCell>}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {!readOnly && (
                <div className="no-print mt-2 flex gap-2">
                  <Input className="h-8 max-w-sm" placeholder="e.g. Valve to flange (Safety valve)" value={newCheck} onChange={e => setNewCheck(e.target.value)} onKeyDown={e => e.key === 'Enter' && addCheck()} />
                  <Button size="sm" variant="outline" onClick={addCheck}>Add row</Button>
                  <Button size="sm" variant="outline" onClick={async () => { try { const r = await api(`/api/packing/${list.id}/checklist`, { method: 'POST', body: { derive: true } }); setChecklist(r.checklist); } catch (e) { showToast(e.message, 'error'); } }}>Fill from valves</Button>
                </div>
              )}
            </div>
          )}

          <p className="mt-4 text-xs text-muted-foreground">
            <b>Declaration:</b> Dear Sir, kindly check all the above materials as per the packing list, item-wise, and confirm within <b>7 days</b> if there are any discrepancies or missing items.
          </p>
          <div className="mt-8 grid grid-cols-4 gap-4">
            {['Stores', 'Production', 'QC', 'Management'].map(r => (
              <div key={r} className="text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <div className="mb-1.5 h-10 border-t" /> {r}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {!readOnly && (
        <Card className="no-print">
          <CardContent className="flex flex-col gap-4 py-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-semibold">Add items</p>
                <p className="text-xs text-muted-foreground">Pull a pending BOM line or a catalogue item, or type a line by hand.</p>
              </div>
              <div className="flex gap-2">
                <Button type="button" size="sm" onClick={() => setAddFromOpen(true)}>From project BOM / catalogue</Button>
                <Button type="button" size="sm" variant="outline" onClick={() => setManualOpen(v => !v)}>{manualOpen ? 'Hide manual line' : 'Type a line'}</Button>
              </div>
            </div>
            {manualOpen && (
              <form onSubmit={addItem} className="grid gap-3 border-t pt-4 sm:grid-cols-6">
                <div className="flex flex-col gap-1.5 sm:col-span-3"><Label className="text-xs">Description *</Label><Input required value={f.material_description} onChange={e => setF({ ...f, material_description: e.target.value })} placeholder="Safety valve" /></div>
                <div className="flex flex-col gap-1.5 sm:col-span-2"><Label className="text-xs">Size / spec</Label><Input value={f.size_spec} onChange={e => setF({ ...f, size_spec: e.target.value })} /></div>
                <div className="flex flex-col gap-1.5"><Label className="text-xs">Qty</Label><Input type="number" min="0" step="any" value={f.qty} onChange={e => setF({ ...f, qty: e.target.value })} /></div>
                <div className="flex flex-col gap-1.5 sm:col-span-2"><Label className="text-xs">MOC</Label><Input value={f.moc} onChange={e => setF({ ...f, moc: e.target.value })} /></div>
                <div className="flex flex-col gap-1.5 sm:col-span-2"><Label className="text-xs">Make</Label><Input value={f.make} onChange={e => setF({ ...f, make: e.target.value })} /></div>
                <div className="flex flex-col gap-1.5"><Label className="text-xs">IBR no</Label><Input value={f.ibr_no} onChange={e => setF({ ...f, ibr_no: e.target.value })} /></div>
                <div className="flex flex-col gap-1.5"><Label className="text-xs">Item code</Label><Input value={f.item_code} onChange={e => setF({ ...f, item_code: e.target.value })} /></div>
                <div className="flex items-end sm:col-span-6"><Button type="submit" size="sm">Add line</Button></div>
              </form>
            )}
          </CardContent>
        </Card>
      )}

      {!readOnly && (
        <AddFromDialog open={addFromOpen} onOpenChange={setAddFromOpen} list={list}
          onAdded={r => { if (r.items) setItems(r.items); else window.location.reload(); /* older per-form lists don't return the lines */ }} />
      )}
    </main>
  );
}
