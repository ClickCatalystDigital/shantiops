'use client';

// components/SalesPaymentTracker.jsx — Sales Payment Tracker (2026-09-19). Two views over Sale
// Orders: Orders (one row per order, milestone checkboxes + remarks, editable inline) and
// Payments (an append-only log, added through a right-side Sheet). Data comes from server props;
// mutations go through PATCH /api/sale-orders/[id] and POST /api/sale-order-payments.
import { salesPeopleOptions } from '@/lib/sales-people.mjs';
import CustomerPicker from '@/components/CustomerPicker';
import { defaultCompanyClient, companyShort } from '@/lib/company-filter.mjs';
import { useState, useMemo, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle, CardAction, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { currentStage, flagsForStage, STAGE_OPTIONS, billValueOf, normalizeRowSettings, ruleContext, firstRule, ruleColor, DEFAULT_ROW_SETTINGS, RULE_COLUMNS, NUMBER_OPS, TEXT_OPS, MAX_CONDITIONS, MAX_RULES } from '@/lib/order-match.mjs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from '@/components/ui/sheet';
import { SettingsIcon, PlusIcon, SearchIcon, ArrowDownIcon, ArrowUpIcon, TrashIcon } from 'lucide-react';
import SearchableSelect from '@/components/SearchableSelect';
import { api, showToast } from '@/lib/client';
import { formatMoney } from '@/lib/format';
import { todayISO } from '@/lib/date';

// Left → right in the UI. Current Stage = the first UNticked step (what's still to do next);
// 'Completed' once every box is ticked.
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

// Tracker status (sale_orders.track_status) → badge look: a tinted background per status, text in
// the normal foreground colour (black in light mode, white in dark).
const STATUS_STYLE = {
  // Solid (not translucent) so the row colour behind never tints the status; dark: twins because
  // SelectTrigger's own dark:bg-input/30 otherwise wins over the plain bg.
  Pending: 'border-red-300 bg-red-200 text-red-950 hover:bg-red-300 dark:border-red-800 dark:bg-red-900 dark:text-red-50 dark:hover:bg-red-800',
  Ready: 'border-sky-300 bg-sky-200 text-sky-950 hover:bg-sky-300 dark:border-sky-800 dark:bg-sky-900 dark:text-sky-50 dark:hover:bg-sky-800',
  WIP: 'border-amber-300 bg-amber-200 text-amber-950 hover:bg-amber-300 dark:border-amber-800 dark:bg-amber-900 dark:text-amber-50 dark:hover:bg-amber-800',
  Dispatched: 'border-emerald-300 bg-emerald-200 text-emerald-950 hover:bg-emerald-300 dark:border-emerald-800 dark:bg-emerald-900 dark:text-emerald-50 dark:hover:bg-emerald-800',
  Closed: 'border-slate-300 bg-slate-200 text-slate-900 hover:bg-slate-300 dark:border-slate-700 dark:bg-slate-700 dark:text-slate-50 dark:hover:bg-slate-600',
};
// Row background: paid in full (green), short by what looks like TDS (yellow), otherwise red.
// Bill Value is informational only and doesn't affect the colour.
// Row colours: rules checked top to bottom, the first match colours the row (cog on the Orders card).
const colKey = k => RULE_COLUMNS.find(c => c.key === k);
const blankCondition = () => ({ left: 'received', op: '<', right: { kind: 'column', column: 'order_value' } });

function ConditionRow({ c, onChange, onRemove }) {
  const col = colKey(c.left), ops = col.type === 'number' ? NUMBER_OPS : TEXT_OPS;
  const sameType = RULE_COLUMNS.filter(x => x.type === col.type);
  const textOptions = c.left === 'stage' ? STAGE_OPTIONS : TRACK_STATUSES;
  return (
    <div className="grid grid-cols-[1fr_auto] items-center gap-1.5 rounded-md bg-muted/40 p-1.5 sm:grid-cols-[1.4fr_1.2fr_6.5rem_1.2fr_auto]">
      <Select value={c.left} onValueChange={k => {
        const nc = colKey(k); onChange(nc.type === col.type ? { ...c, left: k } : { left: k, op: '=', right: { kind: 'value', value: nc.type === 'number' ? 0 : (k === 'stage' ? STAGE_OPTIONS[0] : TRACK_STATUSES[0]) } });
      }}>
        <SelectTrigger size="sm"><SelectValue /></SelectTrigger>
        <SelectContent>{RULE_COLUMNS.map(x => <SelectItem key={x.key} value={x.key}>{x.label}</SelectItem>)}</SelectContent>
      </Select>
      <Button size="icon-sm" variant="ghost" className="sm:hidden" onClick={onRemove} aria-label="Remove condition"><TrashIcon className="size-3.5" /></Button>
      <Select value={c.op} onValueChange={op => onChange({ ...c, op })}>
        <SelectTrigger size="sm"><SelectValue /></SelectTrigger>
        <SelectContent>{ops.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
      </Select>
      {col.type === 'number' ? (
        <Select value={c.right.kind} onValueChange={kind => onChange({ ...c, right: kind === 'column' ? { kind, column: sameType.find(x => x.key !== c.left)?.key || 'order_value' } : { kind, value: 0 } })}>
          <SelectTrigger size="sm"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="value">number</SelectItem><SelectItem value="column">column</SelectItem></SelectContent>
        </Select>
      ) : <span className="hidden sm:block" />}
      {c.right.kind === 'column' ? (
        <Select value={c.right.column} onValueChange={column => onChange({ ...c, right: { kind: 'column', column } })}>
          <SelectTrigger size="sm"><SelectValue /></SelectTrigger>
          <SelectContent>{sameType.map(x => <SelectItem key={x.key} value={x.key}>{x.label}</SelectItem>)}</SelectContent>
        </Select>
      ) : col.type === 'number' ? (
        <Input type="number" className="h-8" value={c.right.value} onChange={e => onChange({ ...c, right: { kind: 'value', value: e.target.value } })} />
      ) : (
        <Select value={String(c.right.value)} onValueChange={value => onChange({ ...c, right: { kind: 'value', value } })}>
          <SelectTrigger size="sm"><SelectValue /></SelectTrigger>
          <SelectContent>{textOptions.map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent>
        </Select>
      )}
      <Button size="icon-sm" variant="ghost" className="hidden sm:inline-flex" onClick={onRemove} aria-label="Remove condition"><TrashIcon className="size-3.5" /></Button>
    </div>
  );
}

// In-page colour picker (swatches + hex). The browser's own colour popup is a separate window whose
// close click lands outside the dialog and used to close the whole overlay.
const COLOR_PRESETS = ['#16a34a', '#65a30d', '#eab308', '#d97706', '#ea580c', '#dc2626', '#db2777', '#9333ea', '#2563eb', '#0ea5e9', '#0d9488', '#64748b'];
function ColorPicker({ value, onChange }) {
  const [hex, setHex] = useState(value);
  useEffect(() => setHex(value), [value]);
  return (
    <div className="flex flex-wrap items-center gap-1">
      {COLOR_PRESETS.map(c => (
        <button key={c} type="button" onClick={() => onChange(c)} aria-label={`Colour ${c}`}
          className={`size-6 rounded-full border-2 ${value.toLowerCase() === c ? 'border-foreground' : 'border-transparent'}`} style={{ backgroundColor: c }} />
      ))}
      <Input className="h-7 w-[5.5rem] font-mono text-xs" value={hex} maxLength={7} aria-label="Hex colour"
        onChange={e => { const v = e.target.value; setHex(v); if (/^#[0-9a-fA-F]{6}$/.test(v)) onChange(v.toLowerCase()); }} />
    </div>
  );
}

function RuleCard({ rule, index, total, count, onChange, onRemove, onMove }) {
  const setCond = (i, c) => onChange({ ...rule, conditions: rule.conditions.map((x, j) => j === i ? c : x) });
  return (
    <div className={`rounded-lg border p-2.5 ${rule.on ? '' : 'opacity-60'}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Checkbox checked={rule.on} onCheckedChange={v => onChange({ ...rule, on: !!v })} aria-label="Rule on" />
        <Input className="h-8 min-w-0 flex-1 basis-32" value={rule.name} onChange={e => onChange({ ...rule, name: e.target.value })} aria-label="Rule name" />
        <span className="rounded border px-2 py-1 text-xs" title="Orders this rule colours (rules above it are checked first)" style={{ backgroundColor: ruleColor(rule) || undefined }}>{count} orders</span>
        <div className="flex">
          <Button size="icon-sm" variant="ghost" disabled={index === 0} onClick={() => onMove(-1)} aria-label="Move up"><ArrowUpIcon className="size-3.5" /></Button>
          <Button size="icon-sm" variant="ghost" disabled={index === total - 1} onClick={() => onMove(1)} aria-label="Move down"><ArrowDownIcon className="size-3.5" /></Button>
          <Button size="icon-sm" variant="ghost" className="text-destructive" onClick={onRemove} aria-label="Delete rule"><TrashIcon className="size-3.5" /></Button>
        </div>
      </div>
      <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
        <ColorPicker value={rule.color} onChange={color => onChange({ ...rule, color })} />
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="text-xs text-muted-foreground">Opacity</span>
          <input type="range" min={0} max={100} value={rule.opacity} onChange={e => onChange({ ...rule, opacity: Number(e.target.value) })} className="min-w-0 flex-1" aria-label="Opacity" />
          <span className="w-9 text-right text-xs tnum">{rule.opacity}%</span>
        </div>
      </div>
      <div className="mt-2 flex flex-col gap-1.5">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">Colour the row when
          <Select value={rule.match} onValueChange={match => onChange({ ...rule, match })}>
            <SelectTrigger size="sm" className="w-28"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">all of these</SelectItem><SelectItem value="any">any of these</SelectItem></SelectContent>
          </Select>
          are true
        </div>
        {rule.conditions.length === 0 && <p className="text-xs text-amber-700">No conditions yet — this rule colours nothing.</p>}
        {rule.conditions.map((c, i) => <ConditionRow key={i} c={c} onChange={nc => setCond(i, nc)} onRemove={() => onChange({ ...rule, conditions: rule.conditions.filter((_, j) => j !== i) })} />)}
        {rule.conditions.length < MAX_CONDITIONS
          ? <Button size="xs" variant="outline" className="self-start" onClick={() => onChange({ ...rule, conditions: [...rule.conditions, blankCondition()] })}><PlusIcon />Add condition ({rule.conditions.length}/{MAX_CONDITIONS})</Button>
          : <p className="text-xs text-muted-foreground">Most conditions per rule: {MAX_CONDITIONS}.</p>}
      </div>
    </div>
  );
}

function RowColorsDialog({ settings, rows, onClose, onSaved }) {
  const [cfg, setCfg] = useState(settings);
  const [rates, setRates] = useState(settings.tdsRates.join(', '));
  const [saving, setSaving] = useState(false);
  const setRule = (i, r) => setCfg(c => ({ ...c, rules: c.rules.map((x, j) => j === i ? r : x) }));
  const move = (i, d) => setCfg(c => { const a = [...c.rules]; [a[i], a[i + d]] = [a[i + d], a[i]]; return { ...c, rules: a }; });
  // How many orders each rule would colour (first match wins), so a rule can be judged before saving.
  const counts = useMemo(() => {
    const cur = { ...cfg, tdsRates: rates.split(',').map(x => Number(x.trim())).filter(x => x > 0) };
    const eff = cur.tdsRates.length ? cur : { ...cur, tdsRates: settings.tdsRates };
    const m = new Map();
    for (const r of rows) { const hit = firstRule(eff, ruleContext(r.ctxInput, eff)); if (hit) m.set(hit.id, (m.get(hit.id) || 0) + 1); }
    return m;
  }, [cfg, rates, rows, settings.tdsRates]);
  async function save(next) {
    setSaving(true);
    try {
      const body = next || { ...cfg, tdsRates: rates.split(',').map(x => Number(x.trim())).filter(x => x > 0) };
      onSaved(await api('/api/settings/pt-row-colors', { method: 'PUT', body }));
      onClose();
    } catch (e) { showToast(e.message, 'error'); } finally { setSaving(false); }
  }
  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="flex max-h-[92vh] flex-col gap-0 p-0 sm:max-w-3xl">
        <DialogHeader className="border-b px-5 py-4"><DialogTitle>Row colours</DialogTitle>
          <p className="text-xs text-muted-foreground">Saved for you only. Rules are checked from the top; the first one that fits colours the row.</p>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 py-4">
          {cfg.rules.map((r, i) => (
            <RuleCard key={r.id + i} rule={r} index={i} total={cfg.rules.length} count={counts.get(r.id) || 0}
              onChange={nr => setRule(i, nr)} onMove={d => move(i, d)} onRemove={() => setCfg(c => ({ ...c, rules: c.rules.filter((_, j) => j !== i) }))} />
          ))}
          {cfg.rules.length < MAX_RULES && (
            <Button variant="outline" className="self-start" onClick={() => setCfg(c => ({ ...c, rules: [...c.rules, { id: `r${Date.now().toString(36)}`, name: 'New rule', on: true, color: '#2563eb', opacity: 20, match: 'all', conditions: [blankCondition()] }] }))}><PlusIcon />Add rule</Button>
          )}
          <div className="grid gap-1.5 sm:max-w-xs">
            <Label>TDS % customers deduct (comma list)</Label>
            <Input value={rates} onChange={e => setRates(e.target.value)} />
            <p className="text-xs text-muted-foreground">Feeds the "Short looks like TDS" column.</p>
          </div>
        </div>
        <DialogFooter className="m-0 border-t px-5 py-3">
          <Button variant="ghost" onClick={() => save(normalizeRowSettings(DEFAULT_ROW_SETTINGS))} disabled={saving}>Reset to defaults</Button>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => save()} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

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
// Small SB / STF tag so rows of the two companies can be told apart under "All companies".
function CompanyTag({ row }) {
  return <span className="rounded border px-1 text-[10px] font-medium text-muted-foreground" title={row.company || 'Shanti Boilers'}>{companyShort(row)}</span>;
}

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

export function PaymentOrdersTab({ saleOrders, payments, invoices, customers = [], users = [], isSalesHead = false, company = null }) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [dir, setDir] = useState('desc');
  const [local, setLocal] = useState({}); // optimistic overlay: { [soId]: { stage_x: 0|1, remarks } }
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(SIZES[0]);
  const [adding, setAdding] = useState(false);
  const [rowCfg, setRowCfg] = useState(() => normalizeRowSettings(null));
  const [cogOpen, setCogOpen] = useState(false);
  useEffect(() => { api('/api/settings/pt-row-colors').then(setRowCfg).catch(() => {}); }, []);
  const [remarkFor, setRemarkFor] = useState(null);
  const [statusFilter, setStatusFilter] = useState('all');
  const [deletingId, setDeletingId] = useState(null);
  // Plan 1i — active Sales users first, then the legacy names already on imported orders.
  const people = useMemo(() => salesPeopleOptions(users, saleOrders.map(o => o.sales_person)), [users, saleOrders]);

  async function deleteOrder(r) {
    if (!window.confirm(`Delete order ${r.so_no}? This can't be undone.`)) return;
    setDeletingId(r.id);
    try {
      await api(`/api/sale-orders/${r.id}`, { method: 'DELETE' });
      showToast(`${r.so_no} deleted`);
      router.refresh();
    } catch (e) { showToast(e.message, 'error'); } finally { setDeletingId(null); }
  }

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
        r.bill = billValueOf(r, invoices);
        r.ctxInput = { orderValue: r.total, billValue: r.bill.value, received: r.received, status: r.track_status, stage: r.stage, cancelled: r.status === 'cancelled' };
        r.rule = firstRule(rowCfg, ruleContext(r.ctxInput, rowCfg));
        return r;
      });
  }, [saleOrders, payments, invoices, local, rowCfg]);

  const rows = useMemo(() => all
    .filter(r => statusFilter === 'all' || r.track_status === statusFilter)
    .filter(r => matches(q, [r.so_no, r.customer_name, r.invoiceNos, r.sales_person, r.track_status, r.remarks || '', r.stage, fmtDate(r.orderDate), r.total, r.bill.value ?? '']))
    .sort(byDate(dir, r => r.orderDate)), [all, q, dir, statusFilter]);

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
        <CardDescription>{company || 'All companies'} · {kpiOrders.length} orders</CardDescription>
        <CardAction className="flex gap-2"><Button size="icon-sm" variant="ghost" onClick={() => setCogOpen(true)} aria-label="Row colours" title="Row colours"><SettingsIcon /></Button><Button size="sm" onClick={() => setAdding(true)}><PlusIcon />Add order</Button></CardAction>
      </CardHeader>
      <CardContent>
        <div className="-mx-1 mb-4 flex snap-x gap-3 overflow-x-auto px-1 pb-1 sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0 sm:pb-0 lg:grid-cols-6">
          {kpis.map((pair, i) => (
            <div key={i} className="flex w-36 shrink-0 snap-start flex-col gap-3 sm:w-auto">
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
        <Toolbar q={q} setQ={v => { setQ(v); setPage(0); }} dir={dir} setDir={f => { setDir(f); setPage(0); }} dateLabel="Order date">
          <Select value={statusFilter} onValueChange={v => { setStatusFilter(v); setPage(0); }}>
            <SelectTrigger className="h-9 w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {TRACK_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        </Toolbar>
        {rows.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">No orders match.</p> : (<>
          <div className="grid gap-2 md:hidden">
            {rows.slice(page * size, (page + 1) * size).map(r => (
              <div key={r.id} className="rounded-xl border p-3" style={{ backgroundColor: ruleColor(r.rule) || undefined }}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 font-semibold"><EditCell value={r.so_no} display={r.so_no} onSave={v => save(r, { so_no: v })} />{!company && <CompanyTag row={r} />}</div>
                    <div className="text-xs text-muted-foreground"><EditCell type="date" value={r.orderDate} display={fmtDate(r.orderDate)} onSave={v => save(r, { order_date: v })} /></div>
                  </div>
                  <Select value={r.track_status || 'Pending'} onValueChange={v => save(r, { track_status: v })}>
                    <SelectTrigger className={`h-8 w-32 gap-1 px-2 text-xs font-medium ${STATUS_STYLE[r.track_status || 'Pending']}`}><SelectValue /></SelectTrigger>
                    <SelectContent>{Object.keys(STATUS_STYLE).map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                {r.packing_status && <div className="text-[10px] text-muted-foreground">Packing: {r.packing_status}</div>}
                <div className="mt-1 text-sm"><EditCell value={r.customer_name} display={r.customer_name || '—'} onSave={v => save(r, { customer_name: v })} /></div>
                <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                  <div><div className="text-muted-foreground">Order value</div><div className="tnum font-medium"><EditCell type="number" value={r.total || ''} display={r.total ? exact(r.total) : '—'} disabled={r.item_count > 0} onSave={v => save(r, { total: Number(v) || 0 })} /></div></div>
                  <div><div className="text-muted-foreground">Received</div><div className="tnum font-medium">{exact(r.received)}</div></div>
                  <div><div className="text-muted-foreground">Pending</div><div className="tnum font-medium">{exact(r.pending)}</div></div>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <Select value={r.stage} onValueChange={v => save(r, flagsForStage(v))}>
                    <SelectTrigger className="h-8 flex-1 gap-1 px-2 text-xs font-medium"><SelectValue /></SelectTrigger>
                    <SelectContent>{STAGE_OPTIONS.map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent>
                  </Select>
                  {isSalesHead && <Button size="icon-sm" variant="ghost" className="text-destructive" disabled={deletingId === r.id} onClick={() => deleteOrder(r)} aria-label="Delete order"><TrashIcon className="size-3.5" /></Button>}
                </div>
                <button type="button" onClick={() => setRemarkFor(r)} className={`mt-1.5 block w-full truncate rounded px-1 py-1 text-left text-xs ${r.remarks ? '' : 'text-muted-foreground'}`}>{r.remarks || 'Add remark'}</button>
              </div>
            ))}
          </div>
          <Table className="hidden md:table">
            <TableHeader>
              <TableRow>
                {['Order Date', 'Order ID', 'Customer Name', 'Invoice No', 'Sales Person', 'Status', 'Order Value', 'Bill Value', 'Payment Received', 'Payment Pending', 'Current Stage', 'Remarks', ''].map(h => <TableHead key={h}>{h}</TableHead>)}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.slice(page * size, (page + 1) * size).map(r => (
                <TableRow key={r.id} style={{ backgroundColor: ruleColor(r.rule) || undefined }}>
                  <TableCell className="whitespace-nowrap"><EditCell type="date" value={r.orderDate} display={fmtDate(r.orderDate)} onSave={v => save(r, { order_date: v })} /></TableCell>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-1.5">
                      <EditCell value={r.so_no} display={r.so_no} onSave={v => save(r, { so_no: v })} />
                      {!company && <CompanyTag row={r} />}
                    </div>
                  </TableCell>
                  <TableCell><EditCell value={r.customer_name} display={r.customer_name || '—'} onSave={v => save(r, { customer_name: v })} /></TableCell>
                  <TableCell><EditCell value={r.invoiceNos} display={r.invoiceNos || '—'} onSave={v => save(r, { invoice_ref: v })} /></TableCell>
                  <TableCell><InlineSelect value={r.sales_person} options={people} onChange={v => save(r, { sales_person: v })} /></TableCell>
                  <TableCell>
                    <Select value={r.track_status || 'Pending'} onValueChange={v => save(r, { track_status: v })}>
                      <SelectTrigger className={`h-7 w-28 gap-1 px-2 text-xs font-medium ${STATUS_STYLE[r.track_status || 'Pending']}`}><SelectValue /></SelectTrigger>
                      <SelectContent>{Object.keys(STATUS_STYLE).map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent>
                    </Select>
                    {r.packing_status && <span className="mt-0.5 block text-[10px] text-muted-foreground" title="Latest packing list for this order">Packing: {r.packing_status}</span>}
                  </TableCell>
                  <TableCell className="tnum">
                    <EditCell type="number" value={r.total || ''} display={r.total ? exact(r.total) : '—'} disabled={r.item_count > 0}
                      title="Has line items — edit the value via Sale Orders → Items & PDF" onSave={v => save(r, { total: Number(v) || 0 })} />
                  </TableCell>
                  <TableCell className="tnum">
                    <EditCell type="number" value={r.bill.value ?? ''} display={r.bill.value != null ? exact(r.bill.value) : '—'} disabled={r.bill.fromInvoices}
                      title="From this order's Sales Invoices" onSave={v => save(r, { bill_value: v === '' ? null : Number(v) })} />
                  </TableCell>
                  <TableCell className="tnum">{exact(r.received)}</TableCell>
                  <TableCell className="tnum">{exact(r.pending)}</TableCell>
                  <TableCell>
                    <Select value={r.stage} onValueChange={v => save(r, flagsForStage(v))}>
                      <SelectTrigger className="h-7 w-44 gap-1 px-2 text-xs font-medium"><SelectValue /></SelectTrigger>
                      <SelectContent>{STAGE_OPTIONS.map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell className="max-w-56">
                    <button type="button" onClick={() => setRemarkFor(r)} title={r.remarks || 'Add remark'}
                      className={`block w-full truncate rounded px-1 py-0.5 text-left text-sm hover:bg-muted ${r.remarks ? '' : 'text-muted-foreground'}`}>
                      {r.remarks || 'Add remark'}
                    </button>
                  </TableCell>
                  <TableCell>
                    {isSalesHead && (
                      <Button size="icon-sm" variant="ghost" className="text-destructive" disabled={deletingId === r.id} onClick={() => deleteOrder(r)}>
                        <TrashIcon className="size-3.5" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </>
        )}
        <Pager page={page} setPage={setPage} size={size} setSize={setSize} total={rows.length} />
      </CardContent>
      {adding && <AddOrderSheet customers={customers} people={people} onClose={() => setAdding(false)} />}
      {cogOpen && <RowColorsDialog settings={rowCfg} rows={all} onClose={() => setCogOpen(false)} onSaved={setRowCfg} />}
      {remarkFor && <RemarksDialog order={remarkFor} onClose={() => setRemarkFor(null)} onSave={v => { save(remarkFor, { remarks: v }); setRemarkFor(null); }} />}
    </Card>
  );
}

// Remarks get a roomy overlay instead of a cramped cell input.
function RemarksDialog({ order, onClose, onSave }) {
  const [text, setText] = useState(order.remarks || '');
  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>Remarks · {order.so_no}</DialogTitle></DialogHeader>
        <p className="text-xs text-muted-foreground">{order.customer_name || '—'}</p>
        <Textarea value={text} onChange={e => setText(e.target.value)} rows={8} autoFocus placeholder="Add a remark" />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => (text.trim() === (order.remarks || '').trim() ? onClose() : onSave(text.trim()))}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
      await api('/api/sale-orders', { method: 'POST', body: { ...f, company: defaultCompanyClient(), so_no: f.so_no.trim(), total: f.total === '' ? 0 : Number(f.total) } });
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
            <CustomerPicker value={f.customer_id} name={f.customer_name}
              onChange={(id, n) => set({ customer_id: Number(id) || null, customer_name: n || '' })}
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

export function PaymentLogTab({ saleOrders, payments, invoices, company = null }) {
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
        <CardDescription>{company || 'All companies'} · {rows.length} payments · {formatMoney(rows.reduce((n, p) => n + (p.amount || 0), 0))}</CardDescription>
        <CardAction><Button size="sm" onClick={() => setAdding(true)}><PlusIcon />Log payment</Button></CardAction>
      </CardHeader>
      <CardContent>
        <Toolbar q={q} setQ={v => { setQ(v); setPage(0); }} dir={dir} setDir={f => { setDir(f); setPage(0); }} dateLabel="Received on" />
        {rows.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">No payments logged.</p> : (<>
          <div className="grid gap-2 md:hidden">
            {rows.slice(page * size, (page + 1) * size).map(p => (
              <div key={p.id} className="rounded-xl border p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0"><div className="font-semibold">{p.so_no}{!company && <> <CompanyTag row={p} /></>}</div><div className="truncate text-sm text-muted-foreground">{p.customer_name || '—'}</div></div>
                  <div className="text-right"><div className="tnum text-base font-semibold"><EditCell type="number" value={p.amount} display={exact(p.amount)} onSave={v => save(p, { amount: Number(v) })} /></div>
                    <div className="text-xs text-muted-foreground"><EditCell type="date" value={p.received_on || ''} display={fmtDate(p.received_on)} onSave={v => save(p, { received_on: v })} /></div></div>
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <InlineSelect value={p.mode} options={MODES} width="w-28" onChange={v => save(p, { mode: v })} />
                  <span>Invoice: {p.invoice_no || '—'}</span>
                  <Button size="icon-sm" variant="ghost" className="ml-auto text-muted-foreground hover:text-destructive" aria-label="Delete payment" onClick={() => remove(p)}><TrashIcon className="size-3.5" /></Button>
                </div>
                {p.remark && <div className="mt-1 text-xs">{p.remark}</div>}
              </div>
            ))}
          </div>
          <Table className="hidden md:table">
            <TableHeader>
              <TableRow>
                {['Order ID', 'Customer Name', 'Order Value', 'Invoice Number', 'Payment Received On', 'Payment Mode', 'Remark', 'Amount Received'].map(h => <TableHead key={h}>{h}</TableHead>)}
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.slice(page * size, (page + 1) * size).map(p => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium whitespace-nowrap">{p.so_no}{!company && <> <CompanyTag row={p} /></>}</TableCell>
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
        </>)}
        <Pager page={page} setPage={setPage} size={size} setSize={setSize} total={rows.length} />
      </CardContent>
      {adding && <AddPaymentSheet saleOrders={saleOrders} payments={payments} invoices={invoices} onClose={() => setAdding(false)} />}
    </Card>
  );
}
