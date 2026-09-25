'use client';

// components/SalesPaymentTracker.jsx — Sales Payment Tracker (2026-09-19). Two views over Sale
// Orders: Orders (one row per order, milestone checkboxes + remarks, editable inline) and
// Payments (an append-only log, added through a right-side Sheet). Data comes from server props;
// mutations go through PATCH /api/sale-orders/[id] and POST /api/sale-order-payments.
import { salesPeopleOptions } from '@/lib/sales-people.mjs';
import { useState, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle, CardAction } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from '@/components/ui/sheet';
import { PlusIcon, SearchIcon, ArrowDownIcon, ArrowUpIcon, TrashIcon } from 'lucide-react';
import SearchableSelect from '@/components/SearchableSelect';
import { api, showToast } from '@/lib/client';
import { formatMoney } from '@/lib/format';
import { todayISO } from '@/lib/date';

// Left → right in the UI. Current Stage = the first UNticked step (what's still to do next);
// 'Completed' once every box is ticked.
const STAGES = [
  { key: 'advance', label: 'Advance' },
  { key: 'dispatched', label: 'Dispatched' },
  { key: 'site_completed', label: 'Site Work Completed' },
  { key: 'commissioning', label: 'Commissioning' },
  { key: 'pending_issue', label: 'Pending Site Issue' },
  { key: 'cleared_issue', label: 'Cleared Issue' },
];
// Same list as the Settings sheet of the legacy Excel tracker.
const MODES = ['NEFT/IMPS', 'Cash', 'Cheque', 'Paytm', 'Credit note', 'Debit Note', 'Other'];
// Salespersons list from the Excel's Settings sheet. The dropdown offers these plus every name
// already on an order. ponytail: move to a settings table if non-developers need to add names.
const TRACK_STATUSES = ['Pending', 'Ready', 'WIP', 'Dispatched', 'Closed'];
// Tables show exact rupees (payment data must be checkable to the paisa); the KPI cards keep the short L/Cr form.
const exact = n => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// DD-Mon-YYYY from an ISO date/datetime string, sliced (no Date object → no timezone drift).
function fmtDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  return m ? `${m[3]}-${MONTHS[Number(m[2]) - 1]}-${m[1]}` : '—';
}
const currentStage = so => STAGES.find(s => !so[`stage_${s.key}`])?.label || 'Completed';

// Tracker status (sale_orders.track_status) → badge look. Pending is intentionally uncolored.
const STATUS_STYLE = {
  // dark: twins are needed — SelectTrigger's own dark:bg-input/30 otherwise wins over the plain bg.
  Pending: 'border bg-transparent text-foreground dark:bg-transparent',
  Ready: 'bg-info/10 text-info dark:bg-info/10 dark:hover:bg-info/15',
  WIP: 'bg-warning/10 text-warning dark:bg-warning/10 dark:hover:bg-warning/15',
  Dispatched: 'bg-success/10 text-success dark:bg-success/10 dark:hover:bg-success/15',
  Closed: 'bg-foreground text-background dark:bg-foreground dark:hover:bg-foreground/90',
};

// Borderless dropdown that reads like text in a table cell (Sales Person, Payment Mode).
// Options may be plain strings or { value, label }.
function InlineSelect({ value, options, onChange, width = 'w-36' }) {
  const norm = options.map(o => (typeof o === 'string' ? { value: o, label: o } : o));
  const opts = !value || norm.some(o => o.value === value) ? norm : [{ value, label: value }, ...norm];
  return (
    <Select value={value || undefined} onValueChange={onChange}>
      <SelectTrigger className={`h-7 ${width} gap-1 border-0 bg-transparent px-1 text-sm shadow-none hover:bg-muted dark:bg-transparent dark:hover:bg-muted`}><SelectValue placeholder="—" /></SelectTrigger>
      <SelectContent>{opts.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
    </Select>
  );
}

// Click-to-edit cell: shows `display`, turns into an input on click; Enter/blur saves, Esc cancels.
// Dates save on pick (the native calendar opens straight away).
function EditCell({ value, display, type = 'text', onSave, disabled, title, className = '' }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const done = useRef(false); // Enter/pick/Esc unmount the input, which can still fire a blur — save once
  function start() { done.current = false; setDraft(value ?? ''); setEditing(true); }
  function commit(v) {
    if (done.current) return;
    done.current = true;
    setEditing(false);
    if (String(v) !== String(value ?? '')) onSave(v);
  }
  if (disabled) return <span title={title} className={className}>{display}</span>;
  if (!editing) {
    return (
      <button type="button" onClick={start} title="Click to edit"
        className={`-mx-1 rounded px-1 text-left hover:bg-muted ${className}`}>{display}</button>
    );
  }
  return (
    <Input autoFocus type={type} value={draft} className="h-8 min-w-32"
      ref={el => { if (el && type === 'date') { try { el.showPicker?.(); } catch {} } }}
      onChange={e => { setDraft(e.target.value); if (type === 'date' && e.target.value) commit(e.target.value); }}
      onBlur={() => commit(draft)}
      onKeyDown={e => { if (e.key === 'Enter') commit(draft); if (e.key === 'Escape') { done.current = true; setEditing(false); } }} />
  );
}

// Shared search box + sort direction toggle (date column), used by both tabs.
function Toolbar({ q, setQ, dir, setDir, dateLabel, children }) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <div className="relative w-full max-w-sm">
        <SearchIcon className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
        <Input className="pl-8" placeholder="Search order, customer, invoice, remarks…" value={q} onChange={e => setQ(e.target.value)} />
      </div>
      <Button size="sm" variant="outline" onClick={() => setDir(d => (d === 'desc' ? 'asc' : 'desc'))}>
        {dir === 'desc' ? <ArrowDownIcon /> : <ArrowUpIcon />}{dateLabel}: {dir === 'desc' ? 'Newest first' : 'Oldest first'}
      </Button>
      {children}
    </div>
  );
}

// 1,000+ rows of editable cells is too heavy to mount at once — page it client-side. Default is a
// small page; the user can raise it, capped at 50.
export const SIZES = [10, 25, 50];
export function Pager({ page, setPage, size, setSize, total }) {
  if (total <= SIZES[0]) return null;
  const pages = Math.max(1, Math.ceil(total / size));
  const from = page * size + 1, to = Math.min(total, (page + 1) * size);
  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
      <span>{from}–{to} of {total}</span>
      <div className="flex items-center gap-2">
        <span>Rows per page</span>
        <Select value={String(size)} onValueChange={v => { setSize(Number(v)); setPage(0); }}>
          <SelectTrigger className="h-8 w-16"><SelectValue /></SelectTrigger>
          <SelectContent>{SIZES.map(n => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}</SelectContent>
        </Select>
        <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Button>
        <Button size="sm" variant="outline" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>Next</Button>
      </div>
    </div>
  );
}

const byDate = (dir, get) => (a, b) => (dir === 'desc' ? -1 : 1) * String(get(a)).localeCompare(String(get(b)));
const matches = (q, parts) => !q.trim() || parts.join(' ').toLowerCase().includes(q.trim().toLowerCase());

export function PaymentOrdersTab({ saleOrders, payments, invoices, customers = [], users = [] }) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [dir, setDir] = useState('desc');
  const [local, setLocal] = useState({}); // optimistic overlay: { [soId]: { stage_x: 0|1, remarks } }
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(SIZES[0]);
  const [adding, setAdding] = useState(false);
  // Plan 1i — active Sales users first, then the legacy names already on imported orders.
  const people = useMemo(() => salesPeopleOptions(users, saleOrders.map(o => o.sales_person)), [users, saleOrders]);

  // All non-cancelled orders with derived fields — the KPI cards read this, the table filters it.
  const all = useMemo(() => {
    const received = new Map();
    for (const p of payments) received.set(p.sale_order_id, (received.get(p.sale_order_id) || 0) + p.amount);
    return saleOrders
      .map(so => {
        const r = { ...so, ...local[so.id] };
        r.orderDate = r.order_date || (r.created_at ? String(r.created_at).slice(0, 10) : '');
        r.invoiceNos = r.invoice_ref || invoices.filter(i => i.sale_order_id === so.id && i.status !== 'cancelled').map(i => i.invoice_no).join(', ');
        r.received = received.get(so.id) || 0;
        r.pending = (r.total || 0) - r.received;
        r.stage = currentStage(r);
        return r;
      });
  }, [saleOrders, payments, invoices, local]);

  const rows = useMemo(() => all
    .filter(r => matches(q, [r.so_no, r.customer_name, r.invoiceNos, r.sales_person, r.track_status, r.remarks || '', r.stage, fmtDate(r.orderDate), r.total]))
    .sort(byDate(dir, r => r.orderDate)), [all, q, dir]);

  // KPI columns — each is a stacked pair. Stage-based ones follow Current Stage; the site/dispatch
  // ones count the ticked boxes (a pending issue that's already cleared no longer counts as pending).
  const kpiOrders = all.filter(r => r.status !== 'cancelled');
  const sum = (f) => kpiOrders.reduce((n, r) => n + f(r), 0);
  const count = (f) => kpiOrders.filter(f).length;
  const completed = count(r => r.stage === 'Completed');
  const totalValue = sum(r => r.total || 0);
  const totalReceived = sum(r => r.received);
  const kpis = [
    [['Total Orders', kpiOrders.length], ['Total Value', formatMoney(totalValue)]],
    [['Pending Orders', kpiOrders.length - completed], ['Completed Orders', completed]],
    [['Total Pending', formatMoney(totalValue - totalReceived)], ['Total Received', formatMoney(totalReceived)]],
    [['Advance', count(r => r.stage === 'Advance')], ['Commissioning', count(r => r.stage === 'Commissioning')]],
    [['Dispatched', count(r => r.stage_dispatched)], ['Pending Site Issues', count(r => r.stage_pending_issue && !r.stage_cleared_issue), true]],
    [['Site Work Completed', count(r => r.stage_site_completed)], ['Cleared Issues', count(r => r.stage_cleared_issue)]],
  ];

  async function save(so, patch) {
    setLocal(l => ({ ...l, [so.id]: { ...l[so.id], ...patch } }));
    try {
      await api(`/api/sale-orders/${so.id}`, { method: 'PATCH', body: patch });
      router.refresh();
    } catch (e) {
      setLocal(l => ({ ...l, [so.id]: Object.fromEntries(Object.keys(patch).map(k => [k, so[k]])) }));
      showToast(e.message, 'error');
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Orders</CardTitle>
        <CardAction><Button size="sm" onClick={() => setAdding(true)}><PlusIcon />Add order</Button></CardAction>
      </CardHeader>
      <CardContent>
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {kpis.map((pair, i) => (
            <div key={i} className="flex flex-col gap-3">
              {pair.map(([label, value, warn]) => (
                <Card key={label} size="sm">
                  <CardContent>
                    <div className={`text-2xl font-semibold tnum ${warn && value > 0 ? 'text-warning' : ''}`}>{value}</div>
                    <div className="text-xs text-muted-foreground">{label}</div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ))}
        </div>
        <Toolbar q={q} setQ={v => { setQ(v); setPage(0); }} dir={dir} setDir={f => { setDir(f); setPage(0); }} dateLabel="Order date" />
        {rows.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">No orders match.</p> : (
          <Table>
            <TableHeader>
              <TableRow>
                {['Order Date', 'Order ID', 'Customer Name', 'Invoice No', 'Sales Person', 'Status', 'Order Value', 'Payment Received', 'Payment Pending', 'Remarks', 'Current Stage'].map(h => <TableHead key={h}>{h}</TableHead>)}
                {STAGES.map(s => <TableHead key={s.key} className="text-center">{s.label}</TableHead>)}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.slice(page * size, (page + 1) * size).map(r => (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-nowrap"><EditCell type="date" value={r.orderDate} display={fmtDate(r.orderDate)} onSave={v => save(r, { order_date: v })} /></TableCell>
                  <TableCell className="font-medium"><EditCell value={r.so_no} display={r.so_no} onSave={v => save(r, { so_no: v })} /></TableCell>
                  <TableCell><EditCell value={r.customer_name} display={r.customer_name || '—'} onSave={v => save(r, { customer_name: v })} /></TableCell>
                  <TableCell><EditCell value={r.invoiceNos} display={r.invoiceNos || '—'} onSave={v => save(r, { invoice_ref: v })} /></TableCell>
                  <TableCell><InlineSelect value={r.sales_person} options={people} onChange={v => save(r, { sales_person: v })} /></TableCell>
                  <TableCell>
                    <Select value={r.track_status || 'Pending'} onValueChange={v => save(r, { track_status: v })}>
                      <SelectTrigger className={`h-7 w-28 gap-1 px-2 text-xs font-medium ${STATUS_STYLE[r.track_status || 'Pending']}`}><SelectValue /></SelectTrigger>
                      <SelectContent>{Object.keys(STATUS_STYLE).map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell className="tnum">
                    <EditCell type="number" value={r.total || ''} display={r.total ? exact(r.total) : '—'} disabled={r.item_count > 0}
                      title="Has line items — edit the value via Sale Orders → Items & PDF" onSave={v => save(r, { total: Number(v) || 0 })} />
                  </TableCell>
                  <TableCell className="tnum">{exact(r.received)}</TableCell>
                  <TableCell className="tnum">{exact(r.pending)}</TableCell>
                  <TableCell className="min-w-44">
                    <Input defaultValue={r.remarks || ''} placeholder="Add remark" className="h-8"
                      onBlur={e => { if (e.target.value !== (r.remarks || '')) save(r, { remarks: e.target.value }); }} />
                  </TableCell>
                  <TableCell className="whitespace-nowrap font-medium">{r.stage}</TableCell>
                  {STAGES.map(s => (
                    <TableCell key={s.key} className="text-center">
                      <Checkbox checked={!!r[`stage_${s.key}`]} onCheckedChange={v => save(r, { [`stage_${s.key}`]: v ? 1 : 0 })} aria-label={s.label} />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <Pager page={page} setPage={setPage} size={size} setSize={setSize} total={rows.length} />
      </CardContent>
      {adding && <AddOrderSheet customers={customers} people={people} onClose={() => setAdding(false)} />}
    </Card>
  );
}

function AddOrderSheet({ customers, people, onClose }) {
  const router = useRouter();
  const [f, setF] = useState({ so_no: '', customer_name: '', customer_id: null, order_date: todayISO(), total: '', sales_person: '', track_status: 'Pending', remarks: '' });
  const [busy, setBusy] = useState(false);
  const set = patch => setF(x => ({ ...x, ...patch }));

  async function submit() {
    setBusy(true);
    try {
      await api('/api/sale-orders', { method: 'POST', body: { ...f, so_no: f.so_no.trim(), total: f.total === '' ? 0 : Number(f.total) } });
      showToast(`Order ${f.so_no.trim()} added`);
      router.refresh();
      onClose();
    } catch (e) {
      showToast(e.message, 'error');
      setBusy(false);
    }
  }

  return (
    <Sheet open onOpenChange={o => !o && onClose()}>
      <SheetContent side="right" className="overflow-y-auto sm:max-w-md">
        <SheetHeader><SheetTitle>Add order</SheetTitle></SheetHeader>
        <div className="flex flex-col gap-4 px-4">
          <div className="space-y-1.5"><Label>Order ID</Label><Input value={f.so_no} onChange={e => set({ so_no: e.target.value })} placeholder="e.g. SAS-506, NIBR-340, SB-1116" autoFocus /></div>
          <div className="space-y-1.5">
            <Label>Customer</Label>
            <SearchableSelect
              value={f.customer_id ? String(f.customer_id) : ''} displayValue={f.customer_name}
              options={customers.map(c => ({ value: String(c.id), label: c.name }))}
              onChange={v => { const c = customers.find(x => String(x.id) === v); set({ customer_id: c?.id ?? null, customer_name: c?.name ?? '' }); }}
              onTextChange={t => set({ customer_name: t, customer_id: null })}
              placeholder="Search customer, or type a new name…" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>Order date</Label><Input type="date" value={f.order_date} onChange={e => set({ order_date: e.target.value })} /></div>
            <div className="space-y-1.5"><Label>Order value</Label><Input type="number" min="0" step="any" value={f.total} onChange={e => set({ total: e.target.value })} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Sales person</Label>
              <Select value={f.sales_person || undefined} onValueChange={v => set({ sales_person: v })}>
                <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                <SelectContent>{people.map(p => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select value={f.track_status} onValueChange={v => set({ track_status: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{TRACK_STATUSES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5"><Label>Remarks</Label><Input value={f.remarks} onChange={e => set({ remarks: e.target.value })} /></div>
        </div>
        <SheetFooter><Button onClick={submit} disabled={busy || !f.so_no.trim()}>Add order</Button></SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function AddPaymentSheet({ saleOrders, payments, invoices, onClose }) {
  const router = useRouter();
  const [soId, setSoId] = useState('');
  const [invoiceId, setInvoiceId] = useState('__none__');
  const [receivedOn, setReceivedOn] = useState(todayISO());
  const [mode, setMode] = useState(MODES[0]);
  const [amount, setAmount] = useState('');
  const [remark, setRemark] = useState('');
  const [busy, setBusy] = useState(false);

  const so = saleOrders.find(s => String(s.id) === soId);
  const received = so ? payments.filter(p => p.sale_order_id === so.id).reduce((n, p) => n + p.amount, 0) : 0;
  const soInvoices = so ? invoices.filter(i => i.sale_order_id === so.id && i.status !== 'cancelled') : [];
  const options = saleOrders.filter(s => s.status !== 'cancelled').map(s => ({ value: String(s.id), label: `${s.so_no} · ${s.customer_name || '—'}` }));

  function pickOrder(v) {
    setSoId(v); setInvoiceId('__none__');
    const s = saleOrders.find(x => String(x.id) === v);
    const paid = payments.filter(p => p.sale_order_id === s.id).reduce((n, p) => n + p.amount, 0);
    setAmount(s.total - paid > 0 ? String(s.total - paid) : '');
  }

  async function submit() {
    setBusy(true);
    try {
      await api('/api/sale-order-payments', {
        method: 'POST',
        body: { sale_order_id: so.id, sales_invoice_id: invoiceId === '__none__' ? null : Number(invoiceId), received_on: receivedOn, mode, amount: Number(amount), remark },
      });
      showToast('Payment logged');
      router.refresh();
      onClose();
    } catch (e) {
      showToast(e.message, 'error');
      setBusy(false);
    }
  }

  return (
    <Sheet open onOpenChange={o => !o && onClose()}>
      <SheetContent side="right" className="overflow-y-auto sm:max-w-md">
        <SheetHeader><SheetTitle>Log a payment</SheetTitle></SheetHeader>
        <div className="flex flex-col gap-4 px-4">
          <div className="space-y-1.5">
            <Label>Order</Label>
            <SearchableSelect value={soId} onChange={pickOrder} options={options} placeholder="Search order or customer…" />
          </div>
          {so && (
            <div className="grid grid-cols-3 gap-2 rounded-md border bg-muted/30 p-3 text-xs">
              <div><div className="text-muted-foreground">Order value</div><div className="tnum font-medium">{formatMoney(so.total)}</div></div>
              <div><div className="text-muted-foreground">Received</div><div className="tnum font-medium">{formatMoney(received)}</div></div>
              <div><div className="text-muted-foreground">Pending</div><div className="tnum font-medium">{formatMoney((so.total || 0) - received)}</div></div>
            </div>
          )}
          {soInvoices.length > 0 && (
            <div className="space-y-1.5">
              <Label>Invoice (optional)</Label>
              <Select value={invoiceId} onValueChange={setInvoiceId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Not against an invoice (e.g. advance)</SelectItem>
                  {soInvoices.map(i => <SelectItem key={i.id} value={String(i.id)}>{i.invoice_no}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>Received on</Label><Input type="date" value={receivedOn} onChange={e => setReceivedOn(e.target.value)} /></div>
            <div className="space-y-1.5">
              <Label>Mode</Label>
              <Select value={mode} onValueChange={setMode}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{MODES.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5"><Label>Amount received</Label><Input type="number" min="0" step="any" value={amount} onChange={e => setAmount(e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Remark</Label><Input value={remark} onChange={e => setRemark(e.target.value)} placeholder="Cheque no., UTR, note…" /></div>
        </div>
        <SheetFooter>
          <Button onClick={submit} disabled={busy || !so || !(Number(amount) > 0) || !receivedOn}>Log payment</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

export function PaymentLogTab({ saleOrders, payments, invoices }) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [dir, setDir] = useState('desc');
  const [adding, setAdding] = useState(false);
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(SIZES[0]);
  const [local, setLocal] = useState({}); // optimistic overlay { [paymentId]: patch | { gone: true } }

  const rows = useMemo(() => payments
    .map(p => ({ ...p, ...local[p.id], invoiceEditable: !p.sales_invoice_id }))
    .filter(p => !p.gone)
    .filter(p => matches(q, [p.so_no, p.customer_name, p.invoice_no || '', p.mode || '', p.remark || '', fmtDate(p.received_on), p.amount, p.order_value]))
    .sort(byDate(dir, p => p.received_on || '')), [payments, local, q, dir]);

  async function save(p, patch) {
    setLocal(l => ({ ...l, [p.id]: { ...l[p.id], ...patch, ...('invoice_ref' in patch ? { invoice_no: patch.invoice_ref } : {}) } }));
    try {
      await api(`/api/sale-order-payments/${p.id}`, { method: 'PATCH', body: patch });
      router.refresh();
    } catch (e) {
      setLocal(l => ({ ...l, [p.id]: Object.fromEntries(Object.keys(patch).map(k => [k, payments.find(x => x.id === p.id)?.[k]])) }));
      showToast(e.message, 'error');
    }
  }

  async function remove(p) {
    if (!confirm(`Delete this ${exact(p.amount)} payment on ${p.so_no}? This can't be undone.`)) return;
    setLocal(l => ({ ...l, [p.id]: { gone: true } }));
    try {
      await api(`/api/sale-order-payments/${p.id}`, { method: 'DELETE' });
      router.refresh();
    } catch (e) {
      setLocal(l => ({ ...l, [p.id]: {} }));
      showToast(e.message, 'error');
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Payments</CardTitle>
        <CardAction><Button size="sm" onClick={() => setAdding(true)}><PlusIcon />Log payment</Button></CardAction>
      </CardHeader>
      <CardContent>
        <Toolbar q={q} setQ={v => { setQ(v); setPage(0); }} dir={dir} setDir={f => { setDir(f); setPage(0); }} dateLabel="Received on" />
        {rows.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">No payments logged.</p> : (
          <Table>
            <TableHeader>
              <TableRow>
                {['Order ID', 'Customer Name', 'Order Value', 'Invoice Number', 'Payment Received On', 'Payment Mode', 'Remark', 'Amount Received'].map(h => <TableHead key={h}>{h}</TableHead>)}
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.slice(page * size, (page + 1) * size).map(p => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">{p.so_no}</TableCell>
                  <TableCell>{p.customer_name || '—'}</TableCell>
                  <TableCell className="tnum">{p.order_value ? exact(p.order_value) : '—'}</TableCell>
                  <TableCell>
                    <EditCell value={p.invoice_ref || ''} display={p.invoice_no || '—'} disabled={!p.invoiceEditable}
                      title="Linked to a system invoice" onSave={v => save(p, { invoice_ref: v })} />
                  </TableCell>
                  <TableCell className="whitespace-nowrap"><EditCell type="date" value={p.received_on || ''} display={fmtDate(p.received_on)} onSave={v => save(p, { received_on: v })} /></TableCell>
                  <TableCell><InlineSelect value={p.mode} options={MODES} width="w-32" onChange={v => save(p, { mode: v })} /></TableCell>
                  <TableCell className="max-w-64"><EditCell value={p.remark || ''} display={<span className="block max-w-60 truncate">{p.remark || '—'}</span>} onSave={v => save(p, { remark: v })} /></TableCell>
                  <TableCell className="tnum font-medium"><EditCell type="number" value={p.amount} display={exact(p.amount)} onSave={v => save(p, { amount: Number(v) })} /></TableCell>
                  <TableCell className="text-right">
                    <Button size="icon" variant="ghost" className="size-7 text-muted-foreground hover:text-destructive" aria-label="Delete payment" onClick={() => remove(p)}><TrashIcon /></Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <Pager page={page} setPage={setPage} size={size} setSize={setSize} total={rows.length} />
      </CardContent>
      {adding && <AddPaymentSheet saleOrders={saleOrders} payments={payments} invoices={invoices} onClose={() => setAdding(false)} />}
    </Card>
  );
}
