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
import { Trash2Icon, FileTextIcon } from 'lucide-react';
import { EntityCode } from '@/components/EntityRefLink';

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

export default function PackingDetail({ list: initialList, items: initialItems, readOnly = false }) {
  const router = useRouter();
  const [list, setList] = useState(initialList);
  const [items, setItems] = useState(initialItems);
  const [f, setF] = useState(BLANK);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initialList);
  const [invoices, setInvoices] = useState([]);
  const [postingFreight, setPostingFreight] = useState(false);
  const [generatingEwayBill, setGeneratingEwayBill] = useState(false);
  const [deleting, setDeleting] = useState(false);

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
    const body = {
      freight_paid_by: draft.freight_paid_by || '', sales_invoice_id: draft.sales_invoice_id || '',
      transport_distance_km: draft.transport_distance_km || '',
      transport_mode: draft.transport_mode || 'road', vehicle_type: draft.vehicle_type || 'regular',
    };
    HEADER_FIELDS.forEach(([k]) => { body[k] = draft[k] || ''; });
    // Once posted, freight_amount is read-only (disabled input above) — leave it out of the body
    // entirely rather than resending the unchanged figure, which would otherwise trip the server's
    // own already-posted guard and block every OTHER field in this same save.
    if (list.freightPosted) delete body.freight_amount;
    try { await api(`/api/packing/${list.id}`, { method: 'PATCH', body }); setList(l => ({ ...l, ...body })); setEditing(false); showToast('Details saved'); }
    catch (err) { showToast(err.message, 'error'); }
  }
  async function deleteList() {
    if (!confirm(`Delete draft ${list.packing_no}? This removes all ${items.length} item${items.length === 1 ? '' : 's'} from it — the underlying BOM lines stay pending and can be pulled into a new draft later.`)) return;
    setDeleting(true);
    try {
      await api(`/api/packing/${list.id}`, { method: 'DELETE' });
      showToast('Draft deleted');
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
      setList(l => ({ ...l, eway_bill_no: res.ewayBillNo, eway_bill_date: res.date }));
      showToast('E-way bill generated');
    } catch (err) { showToast(err.message, 'error'); }
    finally { setGeneratingEwayBill(false); }
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
          {!readOnly && list.status === 'draft' && (
            <Button variant="outline" size="sm" className="text-danger hover:text-danger" disabled={deleting} onClick={deleteList}>
              <Trash2Icon data-icon="inline-start" />{deleting ? 'Deleting…' : 'Delete draft'}
            </Button>
          )}
          <Button asChild size="sm"><a href={`/api/packing/${list.id}/pdf`} target="_blank" rel="noreferrer"><FileTextIcon data-icon="inline-start" />Generate PDF</a></Button>
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
        <Card className="no-print">
          <CardContent className="flex items-center justify-between py-4">
            <div>
              <p className="text-sm font-medium">E-Way Bill</p>
              <p className="text-xs text-muted-foreground">Not yet generated. Needs direct-NIC credentials configured for this project's company under Accounts → Company Entities.</p>
            </div>
            <Button size="sm" disabled={generatingEwayBill} onClick={generateEwayBill}>{generatingEwayBill ? 'Generating…' : 'Generate E-Way Bill'}</Button>
          </CardContent>
        </Card>
      )}

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

          <dl className="mb-4 grid grid-cols-2 gap-x-6 gap-y-2">
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
