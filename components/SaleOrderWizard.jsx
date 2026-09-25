'use client';

// components/SaleOrderWizard.jsx — Sales CRM expansion Phase 2, the "Create PO" action from a
// Lead/Enquiry. Step 1 (small dialog: Expected Date/Week Number/Sales Call Status/Continue-call/
// VIP) creates a real, minimal Sale Order row the moment Continue fires (Gap #34 — a closed tab
// never loses the whole form), then opens Step 2 (this file's SaleOrderDetailsSheet): Order
// Details, Customer Details, Items On Order (warranty/tax/product), Payment Terms, Comments,
// the embedded Payment Log, Attach Files, and the generated order-pdf. Each section saves
// incrementally (PATCH/PUT per section, same click-to-edit idiom SalesPaymentTracker.jsx already
// established), never only at the end.
//
// Deliberately separate from SaleOrderItemsSheet (SalesWorkspace.jsx) — that stays the plain,
// unmodified items+PDF editor every Sale Order already had; this is the richer wizard surface.
import { useState, useEffect } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from '@/components/ui/sheet';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { TrashIcon, PlusIcon, DownloadIcon } from 'lucide-react';
import { api, showToast } from '@/lib/client';
import { todayISO } from '@/lib/date';
import { formatMoney } from '@/lib/format';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { COMPANY_NAMES } from '@/lib/company-profiles.js';

const SALES_CALL_STATUSES = ['Lead - Cold', 'Lead - Hot', 'Lead Project - Dropped', 'Proposals', 'Hot Offers', 'Order Received', 'Order Lost', 'Follow up stage', 'OEM Follow Ups Monthly'];

function isoWeekNumber(dateISO) {
  if (!dateISO) return '';
  const d = new Date(dateISO + 'T00:00:00');
  if (isNaN(d)) return '';
  d.setDate(d.getDate() + 4 - (d.getDay() || 7));
  const yearStart = new Date(d.getFullYear(), 0, 1);
  return String(Math.ceil(((d - yearStart) / 86400000 + 1) / 7));
}

// --- Step 1 -----------------------------------------------------------------------------------

export function CreatePoStep1Dialog({ lead, branches, onClose, onCreated, router }) {
  const [expectedDate, setExpectedDate] = useState(lead.expected_order_date || todayISO());
  const [weekNumber, setWeekNumber] = useState(lead.week_number || isoWeekNumber(lead.expected_order_date || todayISO()));
  const [status, setStatus] = useState(lead.sales_call_status || 'Lead - Cold');
  const [continueCall, setContinueCall] = useState('no');
  const [isVip, setIsVip] = useState(!!lead.is_vip);
  const [branchId, setBranchId] = useState(lead.branch_id ? String(lead.branch_id) : '');
  const [saving, setSaving] = useState(false);

  function onDateChange(v) {
    setExpectedDate(v);
    setWeekNumber(isoWeekNumber(v));
  }

  async function continueToOrder() {
    setSaving(true);
    try {
      await api(`/api/leads/${lead.id}`, { method: 'PATCH', body: {
        expected_order_date: expectedDate || null, week_number: weekNumber || null,
        sales_call_status: status, is_vip: isVip, branch_id: branchId || null,
        // "No — end of the opportunity" closes the sales call; "Yes" leaves it open for further
        // orders. (Was a hand-set status:'converted', which also made the convert call below fail.)
        sales_call_closed_at: continueCall === 'no' ? new Date().toISOString() : undefined,
      } });

      let customerId = lead.converted_customer_id;
      if (!customerId) {
        const res = await api(`/api/leads/${lead.id}/convert`, { method: 'POST', body: {} });
        customerId = res.customer_id;
      }

      const so = await api('/api/sale-orders', { method: 'POST', body: {
        customer_id: customerId, customer_name: lead.company_name || lead.lead_name, company: COMPANY_NAMES[0],
        order_date: expectedDate || null, sales_person: lead.account_manager || null, create_as: 'PO',
        branch_id: branchId || null, order_stage: status, lead_id: lead.id,
      } });

      router.refresh();
      onCreated(so.id);
    } catch (err) { showToast(err.message, 'error'); setSaving(false); }
  }

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Create PO — {lead.lead_name}</DialogTitle></DialogHeader>
        <p className="text-xs text-muted-foreground">
          You have chosen to create a Purchase Order (PO) against the Sales Call. You can update the date of
          Order Expected for another order and the Sales Call Status:
        </p>
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5"><Label>Expected Date</Label><Input type="date" value={expectedDate} onChange={e => onDateChange(e.target.value)} /></div>
            <div className="grid gap-1.5"><Label>Week Number</Label><Input value={weekNumber} onChange={e => setWeekNumber(e.target.value)} /></div>
          </div>
          {branches.length > 0 && (
            <div className="grid gap-1.5"><Label>Branch</Label>
              <Select value={branchId} onValueChange={setBranchId}>
                <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                <SelectContent>{branches.map(b => <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          )}
          <div className="grid gap-1.5"><Label>Sales Call Status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{SALES_CALL_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>Continue the Sales Call after the Order is created?</Label>
            <div className="flex gap-4 text-sm">
              <label className="flex items-center gap-1.5"><input type="radio" checked={continueCall === 'no'} onChange={() => setContinueCall('no')} />No</label>
              <label className="flex items-center gap-1.5"><input type="radio" checked={continueCall === 'yes'} onChange={() => setContinueCall('yes')} />Yes</label>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id="po-vip" checked={isVip} onCheckedChange={v => setIsVip(!!v)} />
            <Label htmlFor="po-vip" className="font-normal">Also move to VIP Prospects?</Label>
          </div>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={continueToOrder} disabled={saving}>{saving ? 'Creating…' : 'Continue'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --- Step 2 -----------------------------------------------------------------------------------

function Field({ label, children }) {
  return <div className="grid gap-1.5">{label && <Label className="text-xs">{label}</Label>}{children}</div>;
}

function ItemRow({ it, onChange, onRemove }) {
  const set = (k) => (v) => onChange({ [k]: v });
  return (
    <div className="grid grid-cols-2 gap-1.5 rounded border p-2 sm:grid-cols-6">
      <Input placeholder="Product code / description" className="sm:col-span-2" value={it.item_description || ''} onChange={e => set('item_description')(e.target.value)} />
      <Input placeholder="Qty" value={it.qty ?? ''} onChange={e => set('qty')(e.target.value)} />
      <Input placeholder="UoM" value={it.uom || ''} onChange={e => set('uom')(e.target.value)} />
      <Input placeholder="Unit Price" value={it.rate ?? ''} onChange={e => set('rate')(e.target.value)} />
      <Input placeholder="Tax %" value={it.item_tax_pct ?? ''} onChange={e => set('item_tax_pct')(e.target.value)} />
      <Input placeholder="Warranty Std (days)" value={it.warranty_std_days ?? ''} onChange={e => set('warranty_std_days')(e.target.value)} />
      <Input placeholder="Warranty Accepted (days)" value={it.warranty_accepted_days ?? ''} onChange={e => set('warranty_accepted_days')(e.target.value)} />
      <Select value={it.from_date_of || ''} onValueChange={set('from_date_of')}>
        <SelectTrigger><SelectValue placeholder="From Date Of" /></SelectTrigger>
        <SelectContent><SelectItem value="D">Delivery (D)</SelectItem><SelectItem value="I">Installation (I)</SelectItem></SelectContent>
      </Select>
      <label className="flex items-center gap-1.5 text-xs"><Checkbox checked={!!it.installation_required} onCheckedChange={v => onChange({ installation_required: !!v })} />Inst Req</label>
      <Input placeholder="Preventive Maintenance" value={it.preventive_maintenance || ''} onChange={e => set('preventive_maintenance')(e.target.value)} />
      <Button size="icon" variant="ghost" onClick={onRemove}><TrashIcon className="size-3.5" /></Button>
    </div>
  );
}

// Payment Collection (Phase 2.5) — "same as what we add new payments inside payments tab":
// SN, payment date, payment mode, Cheque/DD No/Others, Amount, Remark. A compact, scoped-to-this-
// order version of the existing PaymentLogTab (which is a page-level, cross-order tab with its own
// search/pagination — not a natural fit nested inside this one-order sheet), against the same
// sale_order_payments table/POST route.
function PaymentCollectionCard({ saleOrderId }) {
  const [payments, setPayments] = useState([]);
  const [f, setF] = useState({ received_on: todayISO(), mode: 'Cheque', ref: '', amount: '', remark: '' });
  const [saving, setSaving] = useState(false);

  function load() { api(`/api/sale-order-payments?sale_order_id=${saleOrderId}`).then(setPayments).catch(() => {}); }
  useEffect(load, [saleOrderId]);

  async function add() {
    const amount = Number(f.amount);
    if (!(amount > 0)) return showToast('Amount must be a positive number', 'error');
    setSaving(true);
    try {
      await api('/api/sale-order-payments', { method: 'POST', body: {
        sale_order_id: saleOrderId, received_on: f.received_on, mode: f.mode, amount,
        remark: [f.ref, f.remark].filter(Boolean).join(' — ') || null,
      } });
      setF({ received_on: todayISO(), mode: 'Cheque', ref: '', amount: '', remark: '' });
      load();
    } catch (err) { showToast(err.message, 'error'); } finally { setSaving(false); }
  }

  return (
    <div className="flex flex-col gap-3">
      {payments.length > 0 && (
        <Table>
          <TableHeader><TableRow><TableHead>SN</TableHead><TableHead>Date</TableHead><TableHead>Mode</TableHead><TableHead>Remark</TableHead><TableHead>Amount</TableHead></TableRow></TableHeader>
          <TableBody>
            {payments.map((p, i) => (
              <TableRow key={p.id}><TableCell>{i + 1}</TableCell><TableCell>{p.received_on}</TableCell><TableCell>{p.mode || '—'}</TableCell><TableCell>{p.remark || '—'}</TableCell><TableCell>{formatMoney(p.amount)}</TableCell></TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-5">
        <Input type="date" value={f.received_on} onChange={e => setF(p => ({ ...p, received_on: e.target.value }))} />
        <Select value={f.mode} onValueChange={v => setF(p => ({ ...p, mode: v }))}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>{['Cheque', 'DD', 'Cash', 'NEFT/IMPS/RTGS', 'Online', 'Others'].map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
        </Select>
        <Input placeholder="Cheque/DD No" value={f.ref} onChange={e => setF(p => ({ ...p, ref: e.target.value }))} />
        <Input placeholder="Amount" type="number" value={f.amount} onChange={e => setF(p => ({ ...p, amount: e.target.value }))} />
        <Input placeholder="Remark" value={f.remark} onChange={e => setF(p => ({ ...p, remark: e.target.value }))} />
      </div>
      <Button size="sm" className="w-fit" disabled={saving} onClick={add}>{saving ? 'Saving…' : 'Log Payment'}</Button>
    </div>
  );
}

export function SaleOrderDetailsSheet({ saleOrderId, branches, onClose, router }) {
  const [so, setSo] = useState(null);
  const [items, setItems] = useState([]);
  const [saving, setSaving] = useState(null);

  function load() {
    api(`/api/sale-orders/${saleOrderId}`).then(d => {
      setSo(d);
      setItems(d.items.length ? d.items : [{ item_description: '', qty: '', uom: '', rate: '', item_tax_pct: 0 }]);
    }).catch(err => showToast(err.message, 'error'));
  }
  useEffect(load, [saleOrderId]);

  async function saveField(fields) {
    setSaving('fields');
    try {
      await api(`/api/sale-orders/${saleOrderId}`, { method: 'PATCH', body: fields });
      showToast('Saved');
      router.refresh();
      load();
    } catch (err) { showToast(err.message, 'error'); } finally { setSaving(null); }
  }

  function updateRow(i, patch) { setItems(rows => rows.map((r, idx) => idx === i ? { ...r, ...patch } : r)); }
  function addRow() { setItems(rows => [...rows, { item_description: '', qty: '', uom: '', rate: '', item_tax_pct: 0 }]); }
  function removeRow(i) { setItems(rows => rows.filter((_, idx) => idx !== i)); }

  async function saveItems() {
    const rows = items.filter(it => String(it.item_description || '').trim());
    if (!rows.length) return showToast('At least one line item is required', 'error');
    setSaving('items');
    try {
      await api(`/api/sale-orders/${saleOrderId}/items`, { method: 'PUT', body: {
        items: rows, tax_pct: so.tax_pct || 0,
        discount_pct: so.discount_pct || 0, packing_forwarding_amount: so.packing_forwarding_amount || 0,
        insurance_amount: so.insurance_amount || 0, freight_amount: so.freight_amount || 0, other_charges_amount: so.other_charges_amount || 0,
      } });
      showToast('Items On Order saved');
      router.refresh();
      load();
    } catch (err) { showToast(err.message, 'error'); } finally { setSaving(null); }
  }

  async function uploadFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setSaving('file');
    try {
      const fd = new FormData(); fd.append('file', file);
      await fetch(`/api/sale-orders/${saleOrderId}/attachments`, { method: 'POST', body: fd }).then(r => r.json());
      showToast('File attached');
      load();
    } catch (err) { showToast(err.message, 'error'); } finally { setSaving(null); }
  }

  if (!so) return null;
  const set = (k) => (v) => setSo(prev => ({ ...prev, [k]: v }));

  return (
    <Sheet open onOpenChange={o => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader><SheetTitle>{so.so_no} — {so.customer_name}</SheetTitle></SheetHeader>
        <div className="flex flex-col gap-4 px-4 pb-4">
          <Card>
            <CardHeader><CardTitle className="text-sm">Order Details</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-2 gap-3">
              <Field label="Create as">
                <Select value={so.create_as || 'PO'} onValueChange={set('create_as')}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="PO">PO</SelectItem><SelectItem value="RFD">RFD</SelectItem><SelectItem value="Approved">Approved</SelectItem></SelectContent>
                </Select>
              </Field>
              <Field label="Branch">
                <Select value={so.branch_id ? String(so.branch_id) : ''} onValueChange={v => set('branch_id')(v)}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>{branches.map(b => <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field label="Order Date"><Input type="date" value={so.order_date || ''} onChange={e => set('order_date')(e.target.value)} /></Field>
              <Field label="Br Order Control No"><Input value={so.br_order_control_no || ''} onChange={e => set('br_order_control_no')(e.target.value)} /></Field>
              <Field label="Expected Delivery Date"><Input type="date" value={so.expected_delivery_date || ''} onChange={e => set('expected_delivery_date')(e.target.value)} /></Field>
              <Field label="Company"><Input value={so.company} disabled /></Field>
              <Button size="sm" className="col-span-2 w-fit" disabled={saving === 'fields'} onClick={() => saveField({
                create_as: so.create_as, branch_id: so.branch_id, order_date: so.order_date,
                br_order_control_no: so.br_order_control_no, expected_delivery_date: so.expected_delivery_date,
              })}>{saving === 'fields' ? 'Saving…' : 'Save Order Details'}</Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-sm">Customer Details</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-2 gap-3">
              <Field label="Customer"><Input value={so.customer_name || ''} onChange={e => set('customer_name')(e.target.value)} /></Field>
              <Field label="Address Type">
                <Select value={so.address_type || 'Default'} onValueChange={set('address_type')}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="Default">Default</SelectItem><SelectItem value="Other">Other</SelectItem></SelectContent>
                </Select>
              </Field>
              {so.address_type === 'Other' && <Field label="Address"><Textarea rows={2} className="col-span-2" value={so.order_address || ''} onChange={e => set('order_address')(e.target.value)} /></Field>}
              <Field label="Contact Person"><Input value={so.contact_person || ''} onChange={e => set('contact_person')(e.target.value)} /></Field>
              <Field label="Mobile Number"><Input value={so.contact_mobile || ''} onChange={e => set('contact_mobile')(e.target.value)} /></Field>
              <Field label="Order Stage"><Input value={so.order_stage || ''} onChange={e => set('order_stage')(e.target.value)} /></Field>
              <Field label="A/C Manager Name"><Input value={so.sales_person_override || ''} onChange={e => set('sales_person_override')(e.target.value)} /></Field>
              <Button size="sm" className="col-span-2 w-fit" disabled={saving === 'fields'} onClick={() => saveField({
                customer_name: so.customer_name, address_type: so.address_type, order_address: so.order_address,
                contact_person: so.contact_person, contact_mobile: so.contact_mobile, order_stage: so.order_stage,
                sales_person: so.sales_person_override,
              })}>{saving === 'fields' ? 'Saving…' : 'Save Customer Details'}</Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-sm">Attach Files</CardTitle></CardHeader>
            <CardContent className="flex flex-col gap-2">
              {so.files?.map(f => (
                <div key={f.id} className="flex items-center justify-between rounded border px-2 py-1 text-xs">
                  <span>{f.file_name}</span>
                  <a href={`/api/sale-orders/${saleOrderId}/attachments/${f.id}`} target="_blank" rel="noopener noreferrer"><DownloadIcon className="size-3.5" /></a>
                </div>
              ))}
              <Input type="file" onChange={uploadFile} disabled={saving === 'file'} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-sm">Items On Order</CardTitle></CardHeader>
            <CardContent className="flex flex-col gap-2">
              {items.map((it, i) => <ItemRow key={i} it={it} onChange={p => updateRow(i, p)} onRemove={() => removeRow(i)} />)}
              <Button size="sm" variant="outline" className="w-fit" onClick={addRow}><PlusIcon />Add line</Button>
              <div className="grid grid-cols-2 gap-3 border-t pt-2 sm:grid-cols-4">
                <Field label="Discount %"><Input value={so.discount_pct || 0} onChange={e => set('discount_pct')(e.target.value)} /></Field>
                <Field label="Pkg &amp; Fwd"><Input value={so.packing_forwarding_amount || 0} onChange={e => set('packing_forwarding_amount')(e.target.value)} /></Field>
                <Field label="Insurance"><Input value={so.insurance_amount || 0} onChange={e => set('insurance_amount')(e.target.value)} /></Field>
                <Field label="Freight"><Input value={so.freight_amount || 0} onChange={e => set('freight_amount')(e.target.value)} /></Field>
                <Field label="Other Charges"><Input value={so.other_charges_amount || 0} onChange={e => set('other_charges_amount')(e.target.value)} /></Field>
              </div>
              <div className="flex items-center justify-between border-t pt-2 text-sm">
                <span className="text-muted-foreground">Sub Total {formatMoney(so.subtotal)} · CGST {formatMoney(so.cgst_amount)} · SGST {formatMoney(so.sgst_amount)} · IGST {formatMoney(so.igst_amount)}</span>
                <span className="font-semibold">Total {formatMoney(so.total)}</span>
              </div>
              <Button size="sm" disabled={saving === 'items'} onClick={saveItems}>{saving === 'items' ? 'Saving…' : 'Save Items On Order'}</Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-sm">Payment Terms</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-2 gap-3">
              <label className="col-span-2 flex items-center gap-2 text-sm"><Checkbox checked={!!so.is_account_clear} onCheckedChange={v => set('is_account_clear')(!!v)} />Account Clear</label>
              <Field label="Advance with Order"><Input value={so.advance_with_order ?? ''} onChange={e => set('advance_with_order')(e.target.value)} /></Field>
              <Field label="Against Installation"><Input value={so.against_installation ?? ''} onChange={e => set('against_installation')(e.target.value)} /></Field>
              <label className="col-span-2 flex items-center gap-2 text-sm"><Checkbox checked={!!so.is_form_applicable} onCheckedChange={v => set('is_form_applicable')(!!v)} />Any form applicable</label>
              {so.is_form_applicable ? (
                <>
                  <Field label="Form Type"><Input value={so.form_type || ''} onChange={e => set('form_type')(e.target.value)} /></Field>
                  <Field label="Form Due On"><Input type="date" value={so.form_due_on || ''} onChange={e => set('form_due_on')(e.target.value)} /></Field>
                </>
              ) : null}
              <Field label="Payment Mode">
                <Select value={so.expected_payment_mode || ''} onValueChange={set('expected_payment_mode')}>
                  <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                  <SelectContent>{['Cheque', 'DD', 'Cash', 'NEFT/IMPS/RTGS', 'Online', 'Others'].map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field label="Cheque/DD No"><Input value={so.cheque_dd_no || ''} onChange={e => set('cheque_dd_no')(e.target.value)} /></Field>
              <Field label="Payment Plan">
                <div className="flex gap-4 text-sm">
                  <label className="flex items-center gap-1.5"><input type="radio" checked={so.payment_plan === 'Credit Date'} onChange={() => set('payment_plan')('Credit Date')} />Credit Date</label>
                  <label className="flex items-center gap-1.5"><input type="radio" checked={so.payment_plan === 'Create Day'} onChange={() => set('payment_plan')('Create Day')} />Create Day</label>
                </div>
              </Field>
              <Field label="Days from today">
                <Select value={String(so.payment_plan_days ?? '')} onValueChange={v => set('payment_plan_days')(Number(v))}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>{[0, 7, 15, 30, 45, 60].map(n => <SelectItem key={n} value={String(n)}>{n === 0 ? 'Today' : `${n} days`}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Button size="sm" className="col-span-2 w-fit" disabled={saving === 'fields'} onClick={() => saveField({
                is_account_clear: so.is_account_clear, advance_with_order: so.advance_with_order, against_installation: so.against_installation,
                is_form_applicable: so.is_form_applicable, form_type: so.form_type, form_due_on: so.form_due_on,
                expected_payment_mode: so.expected_payment_mode, cheque_dd_no: so.cheque_dd_no,
                payment_plan: so.payment_plan, payment_plan_days: so.payment_plan_days,
              })}>{saving === 'fields' ? 'Saving…' : 'Save Payment Terms'}</Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-sm">Comments</CardTitle></CardHeader>
            <CardContent className="flex flex-col gap-3">
              <Field label="Dispatch Comment"><Textarea rows={2} value={so.dispatch_comment || ''} onChange={e => set('dispatch_comment')(e.target.value)} /></Field>
              <Field label="Installation Comment"><Textarea rows={2} value={so.installation_comment || ''} onChange={e => set('installation_comment')(e.target.value)} /></Field>
              <Button size="sm" className="w-fit" disabled={saving === 'fields'} onClick={() => saveField({ dispatch_comment: so.dispatch_comment, installation_comment: so.installation_comment })}>
                {saving === 'fields' ? 'Saving…' : 'Save Comments'}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-sm">Payment Collection</CardTitle></CardHeader>
            <CardContent><PaymentCollectionCard saleOrderId={saleOrderId} /></CardContent>
          </Card>
        </div>
        <SheetFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
          <a href={`/api/sale-orders/${saleOrderId}/order-pdf`} target="_blank" rel="noopener noreferrer">
            <Button><DownloadIcon />Submit — Generate Order PDF</Button>
          </a>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

// Entry point wiring both steps together, used from LeadDetailSheet's "Create PO" action.
export function CreatePoFlow({ lead, branches, onClose, router }) {
  const [saleOrderId, setSaleOrderId] = useState(null);
  if (!saleOrderId) return <CreatePoStep1Dialog lead={lead} branches={branches} onClose={onClose} onCreated={setSaleOrderId} router={router} />;
  return <SaleOrderDetailsSheet saleOrderId={saleOrderId} branches={branches} onClose={onClose} router={router} />;
}
