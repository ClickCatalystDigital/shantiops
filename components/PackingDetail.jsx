'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { api, showToast, formatDate } from '@/lib/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Trash2Icon, FileTextIcon } from 'lucide-react';

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

export default function PackingDetail({ list: initialList, items: initialItems, readOnly = false }) {
  const [list, setList] = useState(initialList);
  const [items, setItems] = useState(initialItems);
  const [f, setF] = useState(BLANK);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initialList);
  const [invoices, setInvoices] = useState([]);
  const [postingFreight, setPostingFreight] = useState(false);

  useEffect(() => {
    if (!list.project_id) return;
    api(`/api/sales-invoices?project_id=${list.project_id}`).then(setInvoices).catch(() => {});
  }, [list.project_id]);

  async function addItem(e) {
    e.preventDefault();
    if (!f.material_description.trim()) return;
    try {
      const { id } = await api(`/api/packing/${list.id}/items`, { method: 'POST', body: f });
      setItems(xs => [...xs, { ...f, id, s_no: xs.length + 1, qty: Number(f.qty) || 1, unit: "No's" }]);
      setF(BLANK);
    } catch (err) { showToast(err.message, 'error'); }
  }
  async function removeItem(id) {
    try { await api(`/api/packing/${list.id}/items?itemId=${id}`, { method: 'DELETE' }); setItems(xs => xs.filter(x => x.id !== id)); }
    catch (err) { showToast(err.message, 'error'); }
  }
  async function changeStatus(v) {
    setList(l => ({ ...l, status: v }));
    try { await api(`/api/packing/${list.id}`, { method: 'PATCH', body: { status: v } }); }
    catch (err) { showToast(err.message, 'error'); }
  }
  async function saveHeader(e) {
    e.preventDefault();
    const body = { freight_paid_by: draft.freight_paid_by || '', sales_invoice_id: draft.sales_invoice_id || '' };
    HEADER_FIELDS.forEach(([k]) => { body[k] = draft[k] || ''; });
    // Once posted, freight_amount is read-only (disabled input above) — leave it out of the body
    // entirely rather than resending the unchanged figure, which would otherwise trip the server's
    // own already-posted guard and block every OTHER field in this same save.
    if (list.freightPosted) delete body.freight_amount;
    try { await api(`/api/packing/${list.id}`, { method: 'PATCH', body }); setList(l => ({ ...l, ...body })); setEditing(false); showToast('Details saved'); }
    catch (err) { showToast(err.message, 'error'); }
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

  const Meta = ({ label, value }) => (
    <div><dt className="text-xs text-muted-foreground">{label}</dt><dd className="text-sm font-medium">{value || '—'}</dd></div>
  );

  const linkedInvoice = invoices.find(i => i.id === list.sales_invoice_id);

  return (
    <main className="container flex flex-col gap-6 py-8">
      <div className="flex flex-wrap items-start justify-between gap-3 no-print">
        <div>
          <h1 className="text-2xl font-bold tracking-tight tnum">{list.packing_no}</h1>
          <p className="text-sm text-muted-foreground">{list.customer_name}{list.invoice_no ? ` · Invoice ${list.invoice_no}` : ''}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!readOnly && (
            <Select value={list.status} onValueChange={changeStatus}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>{STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          )}
          {!readOnly && <Button variant="outline" size="sm" onClick={() => { setDraft(list); setEditing(v => !v); }}>{editing ? 'Close' : 'Edit details'}</Button>}
          <Button asChild size="sm"><a href={`/api/packing/${list.id}/pdf`} target="_blank" rel="noreferrer"><FileTextIcon data-icon="inline-start" />Generate PDF</a></Button>
          {!readOnly && <Button asChild variant="ghost" size="sm"><Link href="/ops?dept=Dispatch">← All</Link></Button>}
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
                      {invoices.map(i => <SelectItem key={i.id} value={String(i.id)}>{i.invoice_no} · {i.total}</SelectItem>)}
                      {!invoices.length && <SelectItem value="none" disabled>No invoices for this project</SelectItem>}
                    </SelectContent>
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

      {/* Printable document */}
      <Card>
        <CardContent className="py-6">
          <div className="mb-4 text-center">
            <div className="text-lg font-extrabold tracking-tight">SHANTI BOILERS &amp; PRESSURE VESSELS PVT LTD</div>
            <div className="text-xs text-muted-foreground">P-10-10, I.D.A, Nacharam, Hyderabad - 500 056 · Stores@shantiboilers.com</div>
            <div className="mt-1.5 text-sm font-bold">MASTER PACKING LIST</div>
          </div>

          <dl className="mb-4 grid grid-cols-2 gap-x-6 gap-y-2">
            <Meta label="Buyer" value={list.customer_name} />
            <Meta label="Packing No" value={list.packing_no} />
            <Meta label="Address" value={list.customer_address} />
            <Meta label="Package Type" value={list.package_type} />
            <Meta label="Invoice No" value={linkedInvoice?.invoice_no || list.invoice_no} />
            <Meta label="Invoice Date" value={list.invoice_date && formatDate(list.invoice_date)} />
            <Meta label="D.C. No" value={list.dc_no} />
            <Meta label="D.C. Date" value={list.dc_date && formatDate(list.dc_date)} />
            <Meta label="Dispatch Through" value={list.dispatch_through} />
            <Meta label="Vehicle No" value={list.vehicle_no} />
            <Meta label="E-Way Bill No" value={list.eway_bill_no} />
            <Meta label="E-Way Bill Date" value={list.eway_bill_date && formatDate(list.eway_bill_date)} />
          </dl>

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead><TableHead>Description</TableHead><TableHead>MOC</TableHead><TableHead>Size / Spec</TableHead>
                  <TableHead>IBR No</TableHead><TableHead>Item Code</TableHead><TableHead>Box</TableHead><TableHead>Qty</TableHead><TableHead>Make</TableHead>
                  {!readOnly && <TableHead className="no-print" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map(it => (
                  <TableRow key={it.id}>
                    <TableCell className="tnum">{it.s_no}</TableCell>
                    <TableCell className="font-medium">{it.material_description}</TableCell>
                    <TableCell>{it.moc || '—'}</TableCell>
                    <TableCell>{it.size_spec || '—'}</TableCell>
                    <TableCell className="tnum">{it.ibr_no || '—'}</TableCell>
                    <TableCell className="tnum">{it.item_code || '—'}</TableCell>
                    <TableCell>{it.box_no || '—'}</TableCell>
                    <TableCell className="tnum">{it.qty} {it.unit}</TableCell>
                    <TableCell>{it.make || '—'}</TableCell>
                    {!readOnly && (
                      <TableCell className="no-print">
                        <Button variant="ghost" size="icon-sm" onClick={() => removeItem(it.id)}><Trash2Icon className="text-danger" /></Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
                {items.length === 0 && <TableRow><TableCell colSpan={10} className="text-muted-foreground">No items yet.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </div>

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
          <CardContent className="py-5">
            <div className="mb-3 font-semibold">Add Item</div>
            <form onSubmit={addItem} className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <Label>Description *</Label>
                <Input required value={f.material_description} onChange={e => setF({ ...f, material_description: e.target.value })} placeholder="Safety Valve" />
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="flex flex-col gap-1.5"><Label>MOC</Label><Input value={f.moc} onChange={e => setF({ ...f, moc: e.target.value })} /></div>
                <div className="flex flex-col gap-1.5"><Label>Size / Spec</Label><Input value={f.size_spec} onChange={e => setF({ ...f, size_spec: e.target.value })} /></div>
                <div className="flex flex-col gap-1.5"><Label>IBR No</Label><Input value={f.ibr_no} onChange={e => setF({ ...f, ibr_no: e.target.value })} /></div>
                <div className="flex flex-col gap-1.5"><Label>Box No</Label><Input value={f.box_no} onChange={e => setF({ ...f, box_no: e.target.value })} placeholder="SB-LOOSE 3" /></div>
                <div className="flex flex-col gap-1.5"><Label>Qty</Label><Input type="number" min="0" step="any" value={f.qty} onChange={e => setF({ ...f, qty: e.target.value })} /></div>
                <div className="flex flex-col gap-1.5"><Label>Item Code</Label><Input value={f.item_code} onChange={e => setF({ ...f, item_code: e.target.value })} /></div>
              </div>
              <div className="flex flex-col gap-1.5"><Label>Make</Label><Input value={f.make} onChange={e => setF({ ...f, make: e.target.value })} /></div>
              <div><Button type="submit">+ Add Item</Button></div>
            </form>
          </CardContent>
        </Card>
      )}
    </main>
  );
}
