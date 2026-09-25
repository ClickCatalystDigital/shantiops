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
import { lineAmount } from '@/lib/sales-lines.mjs';
import { computeSaleOrderTotals } from '@/lib/sale-order-calc.mjs';
import ProductSearchField from '@/components/ProductSearchField';
import SearchableSelect from '@/components/SearchableSelect';
import { useLeadConvert } from '@/components/ConvertLeadChoice';
import { defaultCompanyClient } from '@/lib/company-filter.mjs';

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

export function CreatePoStep1Dialog({ lead, branches, stages = [], onClose, onCreated, router }) {
  const stageNames = stages.length ? stages.map(st => st.name) : SALES_CALL_STATUSES;
  const [expectedDate, setExpectedDate] = useState(lead.expected_order_date || todayISO());
  const [weekNumber, setWeekNumber] = useState(lead.week_number || isoWeekNumber(lead.expected_order_date || todayISO()));
  // Recording an order is the win — default to the won stage (Order Received), so the enquiry
  // counts in the funnel and win rate without anyone having to remember to change it.
  const wonStage = stages.find(st => st.is_won)?.name;
  const [status, setStatus] = useState(wonStage || lead.sales_call_status || 'Lead - Cold');
  const [continueCall, setContinueCall] = useState('no');
  const [isVip, setIsVip] = useState(!!lead.is_vip);
  const [branchId, setBranchId] = useState(lead.branch_id ? String(lead.branch_id) : '');
  const [saving, setSaving] = useState(false);
  const { convert: convertLead, dialog: convertDialog } = useLeadConvert();

  function onDateChange(v) {
    setExpectedDate(v);
    setWeekNumber(isoWeekNumber(v));
  }

  async function continueToOrder() {
    setSaving(true);
    try {
      // Customer first: if the person cancels the duplicate check, the enquiry is left untouched.
      let customerId = lead.converted_customer_id;
      if (!customerId) {
        customerId = await convertLead(lead); // may ask: existing customer or new (plan 1k)
        if (!customerId) { setSaving(false); return; }
      }
      await api(`/api/leads/${lead.id}`, { method: 'PATCH', body: {
        expected_order_date: expectedDate || null, week_number: weekNumber || null,
        sales_call_status: status, is_vip: isVip, branch_id: branchId || null,
        // "No — end of the opportunity" closes the sales call; "Yes" leaves it open for further
        // orders. (Was a hand-set status:'converted', which also made the convert call below fail.)
        sales_call_closed_at: continueCall === 'no' ? new Date().toISOString() : undefined,
      } });


      const so = await api('/api/sale-orders', { method: 'POST', body: {
        customer_id: customerId, customer_name: lead.company_name || lead.lead_name, company: defaultCompanyClient(),
        order_date: expectedDate || null, sales_person: lead.account_manager || null, create_as: 'PO',
        branch_id: branchId || null, order_stage: status, lead_id: lead.id,
      } });

      router.refresh();
      onCreated(so.id);
    } catch (err) { showToast(err.message, 'error'); setSaving(false); }
  }

  return (
    <>
    {convertDialog}
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
              <SelectContent>{stageNames.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
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
    </>
  );
}

// --- Step 2 -----------------------------------------------------------------------------------

function Field({ label, children }) {
  return <div className="grid gap-1.5">{label && <Label className="text-xs">{label}</Label>}{children}</div>;
}

const BLANK_ITEM = () => ({ product_id: null, product_code: '', item_description: '', qty: '', uom: '', rate: '', discount_pct: 0, item_tax_pct: '', warranty_std_days: '', warranty_accepted_days: '', from_date_of: '', installation_required: 0, preventive_maintenance: '' });

// Sales CRM plan 1h — one line's pre-tax amount (after its own discount) and its total incl. tax.
function lineMoney(it) {
  const amount = lineAmount(it);
  return { amount, total: amount * (1 + (Number(it.item_tax_pct) || 0) / 100) };
}

function pickProduct(p) {
  return { product_id: p.id, product_code: p.product_code || '', item_description: p.product_name, uom: p.unit || '', rate: p.price ?? '', item_tax_pct: p.gst_pct ?? '', hsn_code: p.hsn_code || null, ...(p.warranty_days ? { warranty_std_days: p.warranty_days } : {}) };
}

// Items On Order — a table on desktop, one card per line below md (plan 2e). Product Code picks from
// the Product Master and fills description, unit, price and tax (all still editable).
function ItemsTable({ items, products, onChange, onRemove }) {
  const cell = 'p-1 align-top';
  const num = 'h-8 w-20 text-right';
  const fields = (it, i) => {
    const set = k => e => onChange(i, { [k]: e?.target ? e.target.value : e });
    return {
      code: <ProductSearchField products={products} value={it.product_code || ''} onChange={v => onChange(i, { product_code: v, product_id: null })} onPick={p => onChange(i, pickProduct(p))} />,
      desc: <Input className="h-8 min-w-48" placeholder="Description" value={it.item_description || ''} onChange={set('item_description')} />,
      wStd: <Input className={num} placeholder="days" value={it.warranty_std_days ?? ''} onChange={set('warranty_std_days')} />,
      wAcc: <Input className={num} placeholder="days" value={it.warranty_accepted_days ?? ''} onChange={set('warranty_accepted_days')} />,
      from: (
        <Select value={it.from_date_of || ''} onValueChange={set('from_date_of')}>
          <SelectTrigger className="h-8 w-20"><SelectValue placeholder="—" /></SelectTrigger>
          <SelectContent><SelectItem value="D">D — Delivery</SelectItem><SelectItem value="I">I — Installation</SelectItem></SelectContent>
        </Select>
      ),
      inst: <Checkbox checked={!!it.installation_required} onCheckedChange={v => onChange(i, { installation_required: v ? 1 : 0 })} aria-label="Installation required" />,
      pm: <Input className="h-8 w-28" placeholder="e.g. 2 visits/yr" value={it.preventive_maintenance || ''} onChange={set('preventive_maintenance')} />,
      qty: <Input className={num} value={it.qty ?? ''} onChange={set('qty')} />,
      uom: <Input className="h-8 w-16" placeholder="Nos" value={it.uom || ''} onChange={set('uom')} />,
      rate: <Input className="h-8 w-28 text-right" value={it.rate ?? ''} onChange={set('rate')} />,
      disc: <Input className={num} value={it.discount_pct ?? 0} onChange={set('discount_pct')} />,
      tax: <Input className={num} value={it.item_tax_pct ?? ''} onChange={set('item_tax_pct')} />,
      total: <span className="whitespace-nowrap font-medium">{formatMoney(lineMoney(it).total)}</span>,
      del: <Button size="icon" variant="ghost" onClick={() => onRemove(i)} aria-label="Remove line"><TrashIcon className="size-3.5" /></Button>,
    };
  };
  return (
    <>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-xs">
          <thead className="text-left text-muted-foreground">
            <tr>
              <th className={cell} rowSpan={2}>Product Code</th><th className={cell} rowSpan={2}>Description</th>
              <th className={`${cell} text-center`} colSpan={2}>Warranty</th><th className={cell} rowSpan={2}>From Date Of (D/I)</th>
              <th className={cell} rowSpan={2}>Inst Req</th><th className={cell} rowSpan={2}>Preventive Maintenance</th>
              <th className={cell} rowSpan={2}>Qty</th><th className={cell} rowSpan={2}>Unit</th><th className={cell} rowSpan={2}>Unit Price</th>
              <th className={cell} rowSpan={2}>Disc %</th><th className={cell} rowSpan={2}>Tax %</th><th className={`${cell} text-right`} rowSpan={2}>Total Price</th><th rowSpan={2} />
            </tr>
            <tr><th className={cell}>Std</th><th className={cell}>Accepted</th></tr>
          </thead>
          <tbody>
            {items.map((it, i) => {
              const f = fields(it, i);
              return (
                <tr key={i} className="border-t">
                  <td className={`${cell} w-40`}>{f.code}</td><td className={cell}>{f.desc}</td><td className={cell}>{f.wStd}</td><td className={cell}>{f.wAcc}</td>
                  <td className={cell}>{f.from}</td><td className={`${cell} pt-2.5 text-center`}>{f.inst}</td><td className={cell}>{f.pm}</td>
                  <td className={cell}>{f.qty}</td><td className={cell}>{f.uom}</td><td className={cell}>{f.rate}</td><td className={cell}>{f.disc}</td><td className={cell}>{f.tax}</td>
                  <td className={`${cell} pt-2.5 text-right`}>{f.total}</td><td className={cell}>{f.del}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex flex-col gap-2 md:hidden">
        {items.map((it, i) => {
          const f = fields(it, i);
          const L = (t, c) => <label className="grid gap-1 text-xs text-muted-foreground">{t}{c}</label>;
          return (
            <div key={i} className="grid grid-cols-2 gap-2 rounded border p-2">
              <div className="col-span-2">{L('Product Code', f.code)}</div>
              <div className="col-span-2">{L('Description', f.desc)}</div>
              {L('Warranty Std (days)', f.wStd)}{L('Warranty Accepted (days)', f.wAcc)}
              {L('From Date Of', f.from)}<label className="flex items-center gap-2 pt-5 text-xs">{f.inst} Inst Req</label>
              <div className="col-span-2">{L('Preventive Maintenance', f.pm)}</div>
              {L('Qty', f.qty)}{L('Unit', f.uom)}{L('Unit Price', f.rate)}{L('Disc %', f.disc)}{L('Tax %', f.tax)}
              <div className="flex items-end justify-between"><span className="text-sm">{f.total}</span>{f.del}</div>
            </div>
          );
        })}
      </div>
    </>
  );
}

function ReadOnly({ label, value }) {
  return <div className="grid min-w-0 gap-0.5"><span className="text-xs text-muted-foreground">{label}</span><span className="text-sm [overflow-wrap:anywhere]">{value || '—'}</span></div>;
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

export function SaleOrderDetailsSheet({ saleOrderId, branches, salesProducts = [], users = [], stages = [], onClose, router }) {
  const [so, setSo] = useState(null);
  const [items, setItems] = useState([]);
  const [prefilled, setPrefilled] = useState(false);
  const [discountMode, setDiscountMode] = useState('pct'); // 'pct' | 'amount'
  const [saving, setSaving] = useState(null);

  function load() {
    api(`/api/sale-orders/${saleOrderId}`).then(d => {
      setSo(d);
      const codeOf = id => salesProducts.find(p => p.id === id)?.product_code || '';
      const src = d.items.length ? d.items : d.prefill_items || [];
      setPrefilled(!d.items.length && src.length > 0);
      setItems(src.length ? src.map(it => ({ ...BLANK_ITEM(), ...it, product_code: it.product_code || codeOf(it.product_id), item_tax_pct: it.item_tax_pct ?? '' })) : [BLANK_ITEM()]);
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
  function addRow() { setItems(rows => [...rows, BLANK_ITEM()]); }
  function removeRow(i) { setItems(rows => rows.filter((_, idx) => idx !== i)); }

  async function saveItems() {
    const rows = items.filter(it => String(it.item_description || '').trim());
    if (!rows.length) return showToast('At least one line item is required', 'error');
    setSaving('items');
    try {
      await api(`/api/sale-orders/${saleOrderId}/items`, { method: 'PUT', body: {
        items: rows, tax_pct: so.tax_pct || 0,
        discount_pct: discountMode === 'pct' ? (so.discount_pct || 0) : undefined,
        discount_amount: discountMode === 'amount' ? (so.discount_amount || 0) : undefined, packing_forwarding_amount: so.packing_forwarding_amount || 0,
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
  const ref = so.references || {};
  // Live preview of the totals before saving — the same calc the server runs on save.
  const preview = computeSaleOrderTotals({
    items: items.filter(it => String(it.item_description || '').trim()).map(it => ({ amount: lineAmount(it), item_tax_pct: it.item_tax_pct })),
    discountPct: discountMode === 'pct' ? Number(so.discount_pct) || 0 : 0,
    discountAmount: discountMode === 'amount' ? so.discount_amount : null,
    packingForwarding: so.packing_forwarding_amount, insurance: so.insurance_amount, freight: so.freight_amount, other: so.other_charges_amount,
    companyStateCode: ref.company_state_code, customerStateCode: ref.customer_state_code,
  });
  const stageNames = stages.length ? stages.map(st => st.name) : SALES_CALL_STATUSES;
  // A/C Manager is a Sales username (plan 1i). A legacy free-text name on an imported order is kept
  // visible as its own option so opening the order never silently changes it.
  const managerOpts = users.map(u => ({ value: u.username, label: u.display_name || u.username }));
  if (so.sales_person_override && !managerOpts.some(o => o.value === so.sales_person_override)) {
    managerOpts.unshift({ value: so.sales_person_override, label: `${so.sales_person_override} (not a user)` });
  }

  return (
    <Sheet open onOpenChange={o => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-6xl overflow-y-auto">
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
            <CardHeader><CardTitle className="text-sm">References</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-2 gap-3">
              <ReadOnly label="Our GST No" value={ref.company_gstin} />
              <ReadOnly label="Entity Code" value={ref.entity_code} />
              <ReadOnly label="Our PAN" value={ref.company_pan} />
              <ReadOnly label="SOS No" value={ref.sos_numbers?.length ? `${ref.sos_numbers.join(', ')} (${ref.job_nos.join(', ')})` : 'Not yet — made when Design converts this order'} />
              <ReadOnly label="Customer Code" value={ref.customer_code} />
              <ReadOnly label="Customer PAN" value={ref.customer_pan} />
              <ReadOnly label="Customer GST No" value={ref.customer_gst_no} />
              <p className="col-span-2 text-xs text-muted-foreground">Read only — change these in Accounts → Company Settings or the customer record.</p>
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
              {so.address_type === 'Other'
                ? <div className="col-span-2"><Field label="Address (3 lines)"><Textarea rows={3} value={so.order_address || ''} onChange={e => set('order_address')(e.target.value)} /></Field></div>
                : <div className="col-span-2"><ReadOnly label="Address (customer default)" value={ref.customer_address?.join(', ')} /></div>}
              <Field label="Contact Person"><Input value={so.contact_person || ''} onChange={e => set('contact_person')(e.target.value)} /></Field>
              <Field label="Mobile Number"><Input value={so.contact_mobile || ''} onChange={e => set('contact_mobile')(e.target.value)} /></Field>
              <Field label="Order Stage">
                <Select value={so.order_stage || ''} onValueChange={set('order_stage')}>
                  <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                  <SelectContent>
                    {so.order_stage && !stageNames.includes(so.order_stage) && <SelectItem value={so.order_stage}>{so.order_stage}</SelectItem>}
                    {stageNames.map(n => <SelectItem key={n} value={n}>{n}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="A/C Manager">
                <SearchableSelect value={so.sales_person_override || ''} onChange={set('sales_person_override')} options={managerOpts} placeholder="Select a person…" />
              </Field>
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
              {prefilled && <p className="text-xs text-muted-foreground">Filled in from the {so.quotation_id ? 'quotation' : 'enquiry'} — check and Save.</p>}
              <ItemsTable items={items} products={salesProducts} onChange={updateRow} onRemove={removeRow} />
              <Button size="sm" variant="outline" className="w-fit" onClick={addRow}><PlusIcon />Add line</Button>
              <div className="grid grid-cols-2 gap-3 border-t pt-2 sm:grid-cols-5">
                <Field label="Discount">
                  <div className="flex gap-1">
                    <Select value={discountMode} onValueChange={setDiscountMode}>
                      <SelectTrigger className="w-16"><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="pct">%</SelectItem><SelectItem value="amount">₹</SelectItem></SelectContent>
                    </Select>
                    {discountMode === 'pct'
                      ? <Input value={so.discount_pct ?? 0} onChange={e => set('discount_pct')(e.target.value)} />
                      : <Input value={so.discount_amount ?? 0} onChange={e => set('discount_amount')(e.target.value)} />}
                  </div>
                </Field>
                <Field label="Pkg &amp; Fwd"><Input value={so.packing_forwarding_amount || 0} onChange={e => set('packing_forwarding_amount')(e.target.value)} /></Field>
                <Field label="Insurance"><Input value={so.insurance_amount || 0} onChange={e => set('insurance_amount')(e.target.value)} /></Field>
                <Field label="Freight"><Input value={so.freight_amount || 0} onChange={e => set('freight_amount')(e.target.value)} /></Field>
                <Field label="Other Charges"><Input value={so.other_charges_amount || 0} onChange={e => set('other_charges_amount')(e.target.value)} /></Field>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-2 text-sm">
                <span className="text-muted-foreground">
                  Sub Total {formatMoney(preview.subtotal)} · Discount {formatMoney(preview.discountAmount)} ({preview.discountPct}%)
                  {preview.igst ? ` · IGST ${formatMoney(preview.igst)}` : ` · CGST ${formatMoney(preview.cgst)} · SGST ${formatMoney(preview.sgst)}`}
                </span>
                <span className="font-semibold">Total Order Value {formatMoney(preview.total)}</span>
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
export function CreatePoFlow({ lead, branches, salesProducts = [], users = [], stages = [], onClose, router }) {
  const [saleOrderId, setSaleOrderId] = useState(null);
  if (!saleOrderId) return <CreatePoStep1Dialog lead={lead} branches={branches} stages={stages} onClose={onClose} onCreated={setSaleOrderId} router={router} />;
  return <SaleOrderDetailsSheet saleOrderId={saleOrderId} branches={branches} salesProducts={salesProducts} users={users} stages={stages} onClose={onClose} router={router} />;
}
