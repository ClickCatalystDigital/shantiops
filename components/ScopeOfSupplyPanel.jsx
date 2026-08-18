'use client';

// The confirmed order's handoff to Design + Engineering — matches the client's real Order
// Acknowledgement paper form now (2026-08-17 "complete SOS" pass), not the earlier freeform
// title+spec blob: a document header (client block, PO/offer refs, payment/freight/delivery
// terms) plus priced line items plus totals, and a PDF export in that same layout
// (lib/sos-pdf.js). One header is auto-created on project creation when a sale_order_id is set
// (app/api/projects/route.js), pre-filled with priced line items from the Sale Order and payment
// terms from the quotation; this panel is where Design/Engineering fill in the rest (PO
// no./date, freight/delivery terms, prepared-by) and release it. Shared by both departments (same
// work order, not department-split), so this one component renders in both DesignPanel.jsx and
// DepartmentPanel.jsx's Engineering slot.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, showToast } from '@/lib/client';
import { Card, CardContent, CardHeader, CardTitle, CardAction } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DownloadIcon, PlusIcon, TrashIcon, PencilIcon } from 'lucide-react';

function fmt(n) {
  return n == null ? '—' : Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function HeaderField({ label, value, onSave, canEdit, type = 'text' }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(value || '');
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try { await onSave(val); setEditing(false); } finally { setSaving(false); }
  }

  if (!canEdit) {
    return (
      <div className="flex flex-col gap-0.5">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="text-sm">{value || '—'}</span>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      {editing ? (
        <div className="flex items-center gap-1">
          <Input type={type} value={val} onChange={e => setVal(e.target.value)} className="h-7 text-sm" autoFocus
            onBlur={save} onKeyDown={e => e.key === 'Enter' && save()} disabled={saving} />
        </div>
      ) : (
        <button type="button" onClick={() => { setVal(value || ''); setEditing(true); }}
          className="text-left text-sm hover:underline">
          {value || <span className="text-muted-foreground">Add…</span>}
        </button>
      )}
    </div>
  );
}

function ItemRow({ item, canEdit, onSaved }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ description: item.description, qty: item.qty ?? '', uom: item.uom || '', unit_price: item.unit_price ?? '' });
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await api(`/api/scope-of-supply/${item.scope_of_supply_id}/items/${item.id}`, { method: 'PATCH', body: form });
      setEditing(false);
      onSaved();
    } catch (err) { showToast(err.message, 'error'); } finally { setSaving(false); }
  }

  async function remove() {
    if (!window.confirm(`Remove "${item.description}"?`)) return;
    try {
      await api(`/api/scope-of-supply/${item.scope_of_supply_id}/items/${item.id}`, { method: 'DELETE' });
      onSaved();
    } catch (err) { showToast(err.message, 'error'); }
  }

  if (editing) {
    return (
      <TableRow>
        <TableCell colSpan={canEdit ? 5 : 4}>
          <div className="flex flex-wrap items-center gap-2">
            <Input className="min-w-40 flex-1" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Description" />
            <Input className="w-20" value={form.qty} onChange={e => setForm({ ...form, qty: e.target.value })} placeholder="Qty" />
            <Input className="w-20" value={form.uom} onChange={e => setForm({ ...form, uom: e.target.value })} placeholder="UoM" />
            <Input className="w-28" value={form.unit_price} onChange={e => setForm({ ...form, unit_price: e.target.value })} placeholder="Unit price" />
            <Button size="sm" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save'}</Button>
            <Button size="sm" variant="outline" onClick={() => setEditing(false)}>Cancel</Button>
          </div>
        </TableCell>
      </TableRow>
    );
  }
  return (
    <TableRow>
      <TableCell className="font-medium">{item.description}</TableCell>
      <TableCell className="text-muted-foreground">{[item.qty, item.uom].filter(Boolean).join(' ') || '—'}</TableCell>
      <TableCell className="text-muted-foreground tnum">{fmt(item.unit_price)}</TableCell>
      <TableCell className="tnum">{fmt(item.amount)}</TableCell>
      {canEdit && (
        <TableCell className="flex justify-end gap-1">
          <Button size="icon-sm" variant="ghost" onClick={() => setEditing(true)}><PencilIcon className="size-3.5" /></Button>
          <Button size="icon-sm" variant="ghost" className="text-danger" onClick={remove}><TrashIcon className="size-3.5" /></Button>
        </TableCell>
      )}
    </TableRow>
  );
}

function AddItemRow({ sosId, canEdit, onAdded }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ description: '', qty: '', uom: '', unit_price: '' });
  const [saving, setSaving] = useState(false);

  async function add() {
    if (!form.description.trim()) return showToast('Description is required', 'error');
    setSaving(true);
    try {
      await api(`/api/scope-of-supply/${sosId}/items`, { method: 'POST', body: form });
      setForm({ description: '', qty: '', uom: '', unit_price: '' });
      setOpen(false);
      onAdded();
    } catch (err) { showToast(err.message, 'error'); } finally { setSaving(false); }
  }

  if (!canEdit) return null;
  if (!open) {
    return (
      <div className="px-4 py-2">
        <Button size="sm" variant="outline" onClick={() => setOpen(true)}><PlusIcon data-icon="inline-start" />Add item</Button>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2 px-4 py-2">
      <Input className="min-w-40 flex-1" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Description" autoFocus />
      <Input className="w-20" value={form.qty} onChange={e => setForm({ ...form, qty: e.target.value })} placeholder="Qty" />
      <Input className="w-20" value={form.uom} onChange={e => setForm({ ...form, uom: e.target.value })} placeholder="UoM" />
      <Input className="w-28" value={form.unit_price} onChange={e => setForm({ ...form, unit_price: e.target.value })} placeholder="Unit price" />
      <Button size="sm" disabled={saving} onClick={add}>{saving ? 'Adding…' : 'Add'}</Button>
      <Button size="sm" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
    </div>
  );
}

function SosDocument({ sos, canEdit, router }) {
  async function saveField(field, value) {
    try {
      await api(`/api/scope-of-supply/${sos.id}`, { method: 'PATCH', body: { [field]: value } });
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); throw err; }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {sos.title}
          <Badge variant={sos.status === 'released' ? 'default' : 'outline'}>{sos.status}</Badge>
        </CardTitle>
        <CardAction className="flex items-center gap-2">
          <Button asChild size="sm" variant="outline">
            <a href={`/api/scope-of-supply/${sos.id}/pdf`} target="_blank" rel="noreferrer"><DownloadIcon data-icon="inline-start" />PDF</a>
          </Button>
          {canEdit && sos.status === 'draft' && (
            <Button size="sm" onClick={() => saveField('status', 'released').then(() => showToast('Released'))}>Release</Button>
          )}
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-md border p-3 sm:grid-cols-4">
          <div className="flex flex-col gap-0.5">
            <span className="text-xs text-muted-foreground">Client</span>
            <span className="text-sm font-medium">{sos.customer?.name || '—'}</span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-xs text-muted-foreground">Job No</span>
            <span className="text-sm">{sos.jobNo || '—'}</span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-xs text-muted-foreground">Offer</span>
            <span className="text-sm">{sos.offerNo || '—'}</span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-xs text-muted-foreground">GST No</span>
            <span className="text-sm">{sos.customer?.gst_no || '—'}</span>
          </div>
          <HeaderField label="PO No" value={sos.po_no} canEdit={canEdit} onSave={v => saveField('po_no', v)} />
          <HeaderField label="PO Date" type="date" value={sos.po_date} canEdit={canEdit} onSave={v => saveField('po_date', v)} />
          <HeaderField label="Prepared By" value={sos.prepared_by} canEdit={canEdit} onSave={v => saveField('prepared_by', v)} />
          <HeaderField label="GST %" value={sos.tax_pct} canEdit={canEdit} onSave={v => saveField('tax_pct', v)} />
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Product</TableHead>
              <TableHead>Qty</TableHead>
              <TableHead>Unit Price</TableHead>
              <TableHead>Basic Value</TableHead>
              {canEdit && <TableHead></TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {sos.items.map(it => <ItemRow key={it.id} item={{ ...it, scope_of_supply_id: sos.id }} canEdit={canEdit} onSaved={() => router.refresh()} />)}
            {sos.items.length === 0 && (
              <TableRow><TableCell colSpan={canEdit ? 5 : 4} className="text-center text-sm text-muted-foreground">No line items yet.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
        <AddItemRow sosId={sos.id} canEdit={canEdit} onAdded={() => router.refresh()} />

        <div className="flex flex-col items-end gap-1 border-t pt-3 text-sm">
          <div className="flex w-48 justify-between"><span className="text-muted-foreground">Basic Total</span><span className="tnum">{fmt(sos.basicTotal)}</span></div>
          <div className="flex w-48 justify-between"><span className="text-muted-foreground">GST @ {sos.tax_pct}%</span><span className="tnum">{fmt(sos.taxAmount)}</span></div>
          <div className="flex w-48 justify-between border-t pt-1 font-semibold"><span>Grand Total</span><span className="tnum">{fmt(sos.grandTotal)}</span></div>
        </div>

        <div className="grid gap-3 border-t pt-3 sm:grid-cols-3">
          <HeaderField label="Payment terms" value={sos.payment_terms} canEdit={canEdit} onSave={v => saveField('payment_terms', v)} />
          <HeaderField label="Freight terms" value={sos.freight_terms} canEdit={canEdit} onSave={v => saveField('freight_terms', v)} />
          <HeaderField label="Delivery terms" value={sos.delivery_terms} canEdit={canEdit} onSave={v => saveField('delivery_terms', v)} />
        </div>
      </CardContent>
    </Card>
  );
}

export default function ScopeOfSupplyPanel({ projectId, scopeOfSupply = [], canEdit = false }) {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [adding, setAdding] = useState(false);

  async function addDocument() {
    if (!title.trim()) return;
    setAdding(true);
    try {
      await api('/api/scope-of-supply', { method: 'POST', body: { project_id: projectId, title: title.trim() } });
      setTitle('');
      showToast('Scope of Supply added');
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); } finally { setAdding(false); }
  }

  return (
    <div className="flex flex-col gap-4">
      {scopeOfSupply.length === 0 && (
        <Card>
          <CardContent className="py-6 text-center text-sm text-muted-foreground">
            No Scope of Supply yet — created automatically when this project is linked to a Sale Order.
          </CardContent>
        </Card>
      )}
      {scopeOfSupply.map(sos => <SosDocument key={sos.id} sos={sos} canEdit={canEdit} router={router} />)}
      {canEdit && (
        <div className="flex gap-2">
          <Input placeholder="New work order title" value={title} onChange={e => setTitle(e.target.value)} />
          <Button size="sm" variant="outline" disabled={adding} onClick={addDocument}>Add work order</Button>
        </div>
      )}
    </div>
  );
}
