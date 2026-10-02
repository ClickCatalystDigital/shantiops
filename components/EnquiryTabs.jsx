'use client';

// components/EnquiryTabs.jsx — the tabbed lower half of the enquiry overlay and the customer overlay
// (2026-10-02). Contacts / Address / Statutory / Business / Competitors all read and write the
// CUSTOMER record, so the two overlays show exactly the same data. An enquiry with no customer yet
// shows one "Save to customer" button (the normal duplicate-aware conversion) before anything is
// editable. Products and Follow-up are enquiry-only.
import { useEffect, useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import SearchableSelect from '@/components/SearchableSelect';
import ProductSearchField from '@/components/ProductSearchField';
import { PlusIcon, TrashIcon, SaveIcon, UserRoundIcon, MapPinIcon, ScaleIcon, SwordsIcon, PackageIcon, BriefcaseIcon, CalendarClockIcon, ActivityIcon, IdCardIcon, StarIcon } from 'lucide-react';
import { api, showToast } from '@/lib/client';
import { formatDate, formatMoney } from '@/lib/format';
import { QTY_UNITS } from '@/lib/qty-units.mjs';
import { actionTypeLabel } from '@/lib/action-types.mjs';
import { composeName } from '@/lib/contact-name.mjs';

const TITLES = ['Mr.', 'Ms.', 'Mrs.', 'Dr.'];
const ADDRESS_TYPES = ['Site', 'Office'];
const NATURE = ['Manufacturing', 'Trading', 'Service', 'Assembling', 'Job Work', 'Other'];
const PRODUCT_LINE = ['Single', 'Multiple'];
const SELLS_VIA = ['Dealer network', 'O.E. Supply', 'Treader', 'Exports', 'Direct Sales', 'Buying House'];
const TURNOVER = ['0-5 crores', '5-10 crores', '10-20 crores', '20-50 crores', '50-100 crores', '100 crores or above'];
const UNIT_OPTIONS = QTY_UNITS.map(u => ({ value: u, label: u }));
const opts = list => list.map(v => ({ value: v, label: v }));

function Empty({ children }) {
  return <div className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">{children}</div>;
}

function SaveBar({ onSave, saving, dirty = true, children }) {
  return (
    <div className="flex items-center justify-between gap-2 pt-3">
      <div className="flex gap-2">{children}</div>
      <Button size="sm" onClick={onSave} disabled={saving || !dirty}><SaveIcon className="size-3.5" />{saving ? 'Saving…' : 'Save'}</Button>
    </div>
  );
}

// ---- Customer-backed tabs ------------------------------------------------------------------

function ContactsTab({ customerId, onChanged }) {
  const blank = () => ({ id: null, title: '', first_name: '', last_name: '', designation: '', department: '', mobile: '', phone: '', email: '', is_primary: false, is_authority: false });
  const [rows, setRows] = useState([blank()]);
  const [known, setKnown] = useState({ designation: [], department: [] });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const list = await api(`/api/contacts?customer_id=${customerId}`).catch(() => []);
    setRows(list.length ? list.map(c => ({
      ...c, first_name: c.first_name ?? c.name ?? '', last_name: c.last_name ?? '', title: c.title ?? '', designation: c.designation ?? '',
      department: c.department ?? '', mobile: c.mobile ?? '', phone: c.phone ?? '', email: c.email ?? '', is_primary: !!c.is_primary, is_authority: !!c.is_authority,
    })) : [blank()]);
    setKnown({
      designation: [...new Set(list.map(c => c.designation).filter(Boolean))],
      department: [...new Set(list.map(c => c.department).filter(Boolean))],
    });
  }, [customerId]);
  useEffect(() => { load(); }, [load]);

  const patch = (i, p) => setRows(r => r.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const setPrimary = i => setRows(r => r.map((x, j) => ({ ...x, is_primary: j === i })));

  async function remove(i) {
    const row = rows[i];
    if (row.id) {
      try { await api(`/api/contacts/${row.id}`, { method: 'DELETE' }); } catch (err) { return showToast(err.message, 'error'); }
    }
    setRows(r => (r.length > 1 ? r.filter((_, j) => j !== i) : [blank()]));
  }

  async function save() {
    setSaving(true);
    try {
      for (const r of rows) {
        if (!composeName(r)) continue; // an untouched blank row
        const body = { ...r, customer_id: customerId };
        if (r.id) await api(`/api/contacts/${r.id}`, { method: 'PATCH', body });
        else await api('/api/contacts', { method: 'POST', body });
      }
      showToast('Contacts saved');
      await load(); onChanged?.();
    } catch (err) { showToast(err.message, 'error'); } finally { setSaving(false); }
  }

  return (
    <div>
      <div className="overflow-x-auto rounded-lg border">
        <Table className="min-w-[1100px]">
          <TableHeader>
            <TableRow>
              <TableHead className="w-16">Primary</TableHead><TableHead className="w-20">Authority</TableHead>
              <TableHead className="w-44">Designation</TableHead><TableHead className="w-40">Department</TableHead><TableHead className="w-24">Title</TableHead>
              <TableHead>First name</TableHead><TableHead>Last name</TableHead><TableHead className="w-36">Mobile</TableHead>
              <TableHead className="w-36">Contact no</TableHead><TableHead className="w-52">Email</TableHead><TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r, i) => (
              <TableRow key={r.id ?? `n${i}`}>
                <TableCell><input type="radio" name="primary-contact" aria-label="Primary" className="size-4 accent-primary" checked={r.is_primary} onChange={() => setPrimary(i)} /></TableCell>
                <TableCell><Checkbox aria-label="Authority" checked={r.is_authority} onCheckedChange={v => patch(i, { is_authority: !!v })} /></TableCell>
                <TableCell><SearchableSelect value={r.designation} onChange={v => patch(i, { designation: v })} displayValue={r.designation} onTextChange={v => patch(i, { designation: v })} options={opts(known.designation)} placeholder="Select or type" /></TableCell>
                <TableCell><SearchableSelect value={r.department} onChange={v => patch(i, { department: v })} displayValue={r.department} onTextChange={v => patch(i, { department: v })} options={opts(known.department)} placeholder="Select or type" /></TableCell>
                <TableCell>
                  <Select value={r.title || '_'} onValueChange={v => patch(i, { title: v === '_' ? '' : v })}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="_">—</SelectItem>{TITLES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                  </Select>
                </TableCell>
                <TableCell><Input aria-label="First name" value={r.first_name} onChange={e => patch(i, { first_name: e.target.value })} /></TableCell>
                <TableCell><Input aria-label="Last name" value={r.last_name} onChange={e => patch(i, { last_name: e.target.value })} /></TableCell>
                <TableCell><Input aria-label="Mobile" inputMode="tel" value={r.mobile} onChange={e => patch(i, { mobile: e.target.value })} /></TableCell>
                <TableCell><Input aria-label="Contact no" inputMode="tel" value={r.phone} onChange={e => patch(i, { phone: e.target.value })} /></TableCell>
                <TableCell><Input aria-label="Email" type="email" value={r.email} onChange={e => patch(i, { email: e.target.value })} /></TableCell>
                <TableCell><Button variant="ghost" size="icon-sm" aria-label="Remove contact" className="text-muted-foreground hover:text-destructive" onClick={() => remove(i)}><TrashIcon className="size-4" /></Button></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <SaveBar onSave={save} saving={saving}>
        <Button size="sm" variant="outline" onClick={() => setRows(r => [...r, blank()])}><PlusIcon className="size-3.5" />Add contact</Button>
      </SaveBar>
    </div>
  );
}

function AddressTab({ customerId }) {
  const blank = () => ({ id: null, address_type: 'Office', line1: '', state: '', district: '', sub_location: '', gst_no: '' });
  const [rows, setRows] = useState([blank()]);
  const [saving, setSaving] = useState(false);
  const load = useCallback(async () => {
    const list = await api(`/api/addresses?customer_id=${customerId}`).catch(() => []);
    setRows(list.length ? list.map(a => ({ ...a, address_type: ADDRESS_TYPES.includes(a.address_type) ? a.address_type : 'Office', line1: a.line1 ?? '', state: a.state ?? '', district: a.district ?? a.city ?? '', sub_location: a.sub_location ?? '', gst_no: a.gst_no ?? '' })) : [blank()]);
  }, [customerId]);
  useEffect(() => { load(); }, [load]);
  const patch = (i, p) => setRows(r => r.map((x, j) => (j === i ? { ...x, ...p } : x)));

  async function remove(i) {
    const row = rows[i];
    if (row.id) { try { await api(`/api/addresses/${row.id}`, { method: 'PATCH', body: { active: 0 } }); } catch (err) { return showToast(err.message, 'error'); } }
    setRows(r => (r.length > 1 ? r.filter((_, j) => j !== i) : [blank()]));
  }
  async function save() {
    setSaving(true);
    try {
      for (const r of rows) {
        if (![r.line1, r.state, r.district, r.sub_location, r.gst_no].some(v => String(v || '').trim())) continue;
        if (r.gst_no && !/^[0-9A-Z]{15}$/i.test(r.gst_no.trim())) throw new Error('GST No must be 15 letters/digits');
        const body = { customer_id: customerId, address_type: r.address_type, line1: r.line1, state: r.state, district: r.district, sub_location: r.sub_location, gst_no: r.gst_no };
        if (r.id) await api(`/api/addresses/${r.id}`, { method: 'PATCH', body });
        else await api('/api/addresses', { method: 'POST', body });
      }
      showToast('Addresses saved'); await load();
    } catch (err) { showToast(err.message, 'error'); } finally { setSaving(false); }
  }
  return (
    <div>
      <div className="overflow-x-auto rounded-lg border">
        <Table className="min-w-[900px]">
          <TableHeader><TableRow>
            <TableHead className="w-32">Address type</TableHead><TableHead>Address</TableHead><TableHead className="w-40">State</TableHead>
            <TableHead className="w-40">District</TableHead><TableHead className="w-40">Sub location</TableHead><TableHead className="w-44">GST No</TableHead><TableHead className="w-10" />
          </TableRow></TableHeader>
          <TableBody>
            {rows.map((r, i) => (
              <TableRow key={r.id ?? `n${i}`}>
                <TableCell>
                  <Select value={r.address_type} onValueChange={v => patch(i, { address_type: v })}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>{ADDRESS_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                  </Select>
                </TableCell>
                <TableCell><Input aria-label="Address" value={r.line1} onChange={e => patch(i, { line1: e.target.value })} /></TableCell>
                <TableCell><Input aria-label="State" value={r.state} onChange={e => patch(i, { state: e.target.value })} /></TableCell>
                <TableCell><Input aria-label="District" value={r.district} onChange={e => patch(i, { district: e.target.value })} /></TableCell>
                <TableCell><Input aria-label="Sub location" value={r.sub_location} onChange={e => patch(i, { sub_location: e.target.value })} /></TableCell>
                <TableCell><Input aria-label="GST No" className="uppercase" maxLength={15} value={r.gst_no} onChange={e => patch(i, { gst_no: e.target.value.toUpperCase() })} /></TableCell>
                <TableCell><Button variant="ghost" size="icon-sm" aria-label="Remove address" className="text-muted-foreground hover:text-destructive" onClick={() => remove(i)}><TrashIcon className="size-4" /></Button></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <SaveBar onSave={save} saving={saving}>
        <Button size="sm" variant="outline" onClick={() => setRows(r => [...r, blank()])}><PlusIcon className="size-3.5" />Add address</Button>
      </SaveBar>
    </div>
  );
}

// A simple form over customer columns: Statutory (text inputs) and Business Details (dropdowns).
function CustomerFieldsForm({ customerId, fields, onSaved }) {
  const [vals, setVals] = useState({});
  const [orig, setOrig] = useState({});
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    api(`/api/customers/${customerId}`).then(c => {
      const v = Object.fromEntries(fields.map(f => [f.key, c[f.key] ?? '']));
      setVals(v); setOrig(v);
    }).catch(() => {});
  }, [customerId]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = fields.some(f => (vals[f.key] ?? '') !== (orig[f.key] ?? ''));
  async function save() {
    setSaving(true);
    try {
      const body = Object.fromEntries(fields.map(f => [f.key, vals[f.key] ?? '']));
      if (body.gst_no && !/^[0-9A-Z]{15}$/i.test(body.gst_no)) throw new Error('GST No must be 15 letters/digits');
      if (body.pan && !/^[A-Z]{5}[0-9]{4}[A-Z]$/i.test(body.pan)) throw new Error('PAN looks wrong (e.g. ABCDE1234F)');
      await api(`/api/customers/${customerId}`, { method: 'PATCH', body });
      setOrig({ ...vals }); showToast('Saved'); onSaved?.();
    } catch (err) { showToast(err.message, 'error'); } finally { setSaving(false); }
  }
  return (
    <div>
      <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
        {fields.map(f => (
          <div key={f.key} className="grid gap-1.5">
            <Label>{f.label}</Label>
            {f.options ? (
              <Select value={vals[f.key] || '_'} onValueChange={v => setVals(s => ({ ...s, [f.key]: v === '_' ? '' : v }))}>
                <SelectTrigger className="w-full"><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent><SelectItem value="_">—</SelectItem>{f.options.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
              </Select>
            ) : (
              <Input value={vals[f.key] ?? ''} className={f.upper ? 'uppercase' : ''} onChange={e => setVals(s => ({ ...s, [f.key]: f.upper ? e.target.value.toUpperCase() : e.target.value }))} />
            )}
          </div>
        ))}
      </div>
      <SaveBar onSave={save} saving={saving} dirty={dirty} />
    </div>
  );
}

const STATUTORY = [
  { key: 'pan', label: 'PAN No', upper: true }, { key: 'service_tax_no', label: 'Service Tax No' }, { key: 'vat_no', label: 'VAT No' },
  { key: 'registration_no', label: 'Registration No' }, { key: 'gst_no', label: 'GST No', upper: true }, { key: 'ecc_no', label: 'ECC No' },
];
const BUSINESS = [
  { key: 'nature_of_business', label: 'Nature of business', options: NATURE }, { key: 'product_line', label: 'Product line', options: PRODUCT_LINE },
  { key: 'sells_via', label: 'How do you sell', options: SELLS_VIA }, { key: 'turnover_band', label: 'Turnover', options: TURNOVER },
];

function CompetitorsTab({ customerId, leadId }) {
  const [rows, setRows] = useState([]);
  const [f, setF] = useState({ competitor: '', product: '', price: '', lost_to: false });
  const q = leadId ? `lead_id=${leadId}` : `customer_id=${customerId}`;
  const load = useCallback(() => { api(`/api/competitors?${q}`).then(setRows).catch(() => {}); }, [q]);
  useEffect(load, [load]);
  async function add() {
    if (!f.competitor.trim()) return showToast('Enter the competitor name', 'error');
    if (f.price !== '' && !(Number(f.price) >= 0)) return showToast('Price must be a number', 'error');
    try {
      await api('/api/competitors', { method: 'POST', body: { ...f, customer_id: customerId || undefined, lead_id: leadId || undefined } });
      setF({ competitor: '', product: '', price: '', lost_to: false }); load();
    } catch (err) { showToast(err.message, 'error'); }
  }
  async function del(c) { try { await api(`/api/competitors/${c.id}`, { method: 'DELETE' }); load(); } catch (err) { showToast(err.message, 'error'); } }
  return (
    <div className="flex flex-col gap-3">
      {rows.length === 0 ? <Empty>No competitors recorded yet.</Empty> : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader><TableRow><TableHead>Competitor</TableHead><TableHead>Their product</TableHead><TableHead className="text-right">Price</TableHead><TableHead /><TableHead className="w-10" /></TableRow></TableHeader>
            <TableBody>
              {rows.map(c => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.competitor}</TableCell><TableCell>{c.product || '—'}</TableCell>
                  <TableCell className="text-right tnum">{c.price != null ? formatMoney(c.price) : '—'}</TableCell>
                  <TableCell>{c.lost_to ? <Badge variant="destructive">Lost to</Badge> : null}</TableCell>
                  <TableCell><Button variant="ghost" size="icon-sm" aria-label="Delete" className="text-muted-foreground hover:text-destructive" onClick={() => del(c)}><TrashIcon className="size-4" /></Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <div className="grid items-end gap-2 sm:grid-cols-[1fr_1fr_8rem_auto_auto]">
        <div className="grid gap-1.5"><Label>Competitor</Label><Input value={f.competitor} onChange={e => setF({ ...f, competitor: e.target.value })} /></div>
        <div className="grid gap-1.5"><Label>Their product</Label><Input value={f.product} onChange={e => setF({ ...f, product: e.target.value })} /></div>
        <div className="grid gap-1.5"><Label>Price (₹)</Label><Input type="number" min="0" value={f.price} onChange={e => setF({ ...f, price: e.target.value })} /></div>
        <label className="flex h-9 items-center gap-2 text-sm"><Checkbox checked={f.lost_to} onCheckedChange={v => setF({ ...f, lost_to: !!v })} />We lost to them</label>
        <Button size="sm" onClick={add}><PlusIcon className="size-3.5" />Add</Button>
      </div>
    </div>
  );
}

// ---- Enquiry-only tabs ---------------------------------------------------------------------

function ProductsTab({ lead, salesProducts, router }) {
  const fromLead = () => (lead.products || []).map(p => ({
    product_id: p.product_id || null, description: p.description || '', instrument: p.instrument || '', qty: p.qty ?? '', unit: p.unit || '',
    rate: p.rate ?? '', gst_pct: p.gst_pct ?? '', is_primary: !!p.is_primary, is_firm: !!p.is_firm,
  }));
  const [lines, setLines] = useState(() => { const l = fromLead(); return l.length ? l : [blankLine()]; });
  const [saving, setSaving] = useState(false);
  const byId = new Map(salesProducts.map(p => [p.id, p]));
  function blankLine() { return { product_id: null, description: '', instrument: '', qty: '', unit: '', rate: '', gst_pct: '', is_primary: false, is_firm: false }; }
  const patch = (i, p) => setLines(l => l.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const pick = (i, p) => patch(i, { product_id: p.id, description: p.product_name, unit: p.unit || '', rate: p.price ?? '', gst_pct: p.gst_pct ?? '' });
  const setPrimary = i => setLines(l => l.map((x, j) => ({ ...x, is_primary: j === i })));
  const setFirm = i => setLines(l => l.map((x, j) => ({ ...x, is_firm: j === i })));
  const amount = l => (l.rate === '' || l.rate == null ? null : (Number(l.qty) || 1) * Number(l.rate));
  const total = lines.reduce((a, l) => a + (amount(l) || 0), 0);
  async function save() {
    setSaving(true);
    try {
      await api(`/api/leads/${lead.id}`, { method: 'PATCH', body: { products: lines.filter(l => l.description.trim() || l.product_id) } });
      showToast('Products saved'); router.refresh();
    } catch (err) { showToast(err.message, 'error'); } finally { setSaving(false); }
  }
  return (
    <div>
      <div className="overflow-x-auto rounded-lg border">
        <Table className="min-w-[1180px]">
          <TableHeader><TableRow>
            <TableHead className="w-60">Product</TableHead><TableHead className="w-32">Code</TableHead><TableHead>Description</TableHead><TableHead className="w-32">Instrument</TableHead>
            <TableHead className="w-28">Unit quote price</TableHead><TableHead className="w-20">Qty</TableHead><TableHead className="w-24">Unit</TableHead>
            <TableHead className="w-28 text-right">Quote price</TableHead><TableHead className="w-16">Primary</TableHead><TableHead className="w-24">Firm prospect</TableHead><TableHead className="w-10" />
          </TableRow></TableHeader>
          <TableBody>
            {lines.map((l, i) => {
              const prod = l.product_id ? byId.get(l.product_id) : null;
              return (
                <TableRow key={i}>
                  <TableCell><ProductSearchField products={salesProducts} value={l.description} onChange={v => patch(i, { description: v, product_id: null })} onPick={p => pick(i, p)} /></TableCell>
                  <TableCell className="text-xs text-muted-foreground">{prod?.product_code || '—'}</TableCell>
                  <TableCell className="max-w-64 truncate text-xs text-muted-foreground" title={prod?.description || ''}>{prod?.description || prod?.product_type || '—'}</TableCell>
                  <TableCell><Input aria-label="Instrument" value={l.instrument} onChange={e => patch(i, { instrument: e.target.value })} /></TableCell>
                  <TableCell><Input aria-label="Unit quote price" type="number" min="0" value={l.rate} onChange={e => patch(i, { rate: e.target.value })} /></TableCell>
                  <TableCell><Input aria-label="Qty" type="number" min="0" value={l.qty} onChange={e => patch(i, { qty: e.target.value })} /></TableCell>
                  <TableCell><SearchableSelect value={l.unit} onChange={v => patch(i, { unit: v })} options={UNIT_OPTIONS} displayValue={l.unit} onTextChange={v => patch(i, { unit: v })} placeholder="Unit" /></TableCell>
                  <TableCell className="text-right tnum">{amount(l) == null ? '—' : formatMoney(amount(l))}</TableCell>
                  <TableCell><input type="radio" name="primary-product" aria-label="Primary" className="size-4 accent-primary" checked={l.is_primary} onChange={() => setPrimary(i)} /></TableCell>
                  <TableCell><input type="radio" name="firm-product" aria-label="Firm prospect" className="size-4 accent-primary" checked={l.is_firm} onChange={() => setFirm(i)} /></TableCell>
                  <TableCell><Button variant="ghost" size="icon-sm" aria-label="Remove product" className="text-muted-foreground hover:text-destructive" onClick={() => setLines(x => (x.length > 1 ? x.filter((_, j) => j !== i) : [blankLine()]))}><TrashIcon className="size-4" /></Button></TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <SaveBar onSave={save} saving={saving}>
        <Button size="sm" variant="outline" onClick={() => setLines(l => [...l, blankLine()])}><PlusIcon className="size-3.5" />Add product</Button>
        {total > 0 && <span className="self-center text-sm text-muted-foreground">Total before GST <span className="font-semibold text-foreground tnum">{formatMoney(total)}</span></span>}
      </SaveBar>
    </div>
  );
}

function ProfileTab({ lead, router, users, sourceOptions }) {
  const [src, setSrc] = useState(lead.source || '');
  const [ref, setRef] = useState(lead.reference || '');
  const [vip, setVip] = useState(!!lead.is_vip);
  const [saving, setSaving] = useState(false);
  useEffect(() => { setSrc(lead.source || ''); setRef(lead.reference || ''); setVip(!!lead.is_vip); }, [lead.id, lead.source, lead.reference, lead.is_vip]);
  const dirty = src !== (lead.source || '') || ref !== (lead.reference || '') || vip !== !!lead.is_vip;
  async function save() {
    setSaving(true);
    try {
      const body = {};
      if (src !== (lead.source || '')) body.source = src;
      if (ref !== (lead.reference || '')) body.reference = ref;
      if (vip !== !!lead.is_vip) body.is_vip = vip;
      await api(`/api/leads/${lead.id}`, { method: 'PATCH', body });
      showToast('Saved'); router.refresh();
    } catch (err) { showToast(err.message, 'error'); } finally { setSaving(false); }
  }
  return (
    <div>
      <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="flex items-center gap-2 text-sm sm:col-span-2 lg:col-span-3"><Checkbox checked={vip} onCheckedChange={v => setVip(!!v)} /><StarIcon className="size-4 text-amber-500" />VIP prospect</label>
        <div className="grid gap-1.5"><Label>Source</Label><SearchableSelect value={src} onChange={setSrc} displayValue={src} onTextChange={setSrc} options={sourceOptions} placeholder="Select or type" /></div>
        <div className="grid gap-1.5"><Label>Reference</Label><Input value={ref} onChange={e => setRef(e.target.value)} placeholder="Who referred them?" /></div>
      </div>
      <SaveBar onSave={save} saving={saving} dirty={dirty} />
    </div>
  );
}

function FollowUpTab({ lead, users }) {
  const [notes, setNotes] = useState(null);
  const [contacts, setContacts] = useState([]);
  useEffect(() => {
    api(`/api/crm-notes?lead_id=${lead.id}`).then(setNotes).catch(() => setNotes([]));
    if (lead.converted_customer_id) api(`/api/contacts?customer_id=${lead.converted_customer_id}`).then(setContacts).catch(() => {});
  }, [lead.id, lead.converted_customer_id]);
  const who = u => users.find(x => x.username === u)?.display_name || u || '—';
  const rows = (notes || []).filter(n => n.next_plan_date || n.plan_date || n.plan_of_action || n.action_taken)
    .sort((a, b) => String(b.next_plan_date || b.plan_date || b.visit_date || b.created_at).localeCompare(String(a.next_plan_date || a.plan_date || a.visit_date || a.created_at)));
  if (notes === null) return <Empty>Loading…</Empty>;
  if (!rows.length) return <Empty>No follow-ups yet. Use “Add to Diary” to plan one.</Empty>;
  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table className="min-w-[860px]">
        <TableHeader><TableRow>
          <TableHead className="w-28">Date</TableHead><TableHead>Contact</TableHead><TableHead>Action type</TableHead><TableHead>Action taken</TableHead>
          <TableHead>Plan of action</TableHead><TableHead>Updated by</TableHead><TableHead>Urgent</TableHead>
        </TableRow></TableHeader>
        <TableBody>
          {rows.map(n => (
            <TableRow key={n.id}>
              <TableCell className="whitespace-nowrap">{formatDate(n.next_plan_date || n.plan_date || n.visit_date || n.created_at)}</TableCell>
              <TableCell>{contacts.find(c => c.id === n.contact_id)?.name || '—'}</TableCell>
              <TableCell>{actionTypeLabel(n.plan_note_type || n.note_type)}</TableCell>
              <TableCell className="max-w-56 truncate" title={n.action_taken || n.content}>{n.action_taken || n.content || '—'}</TableCell>
              <TableCell className="max-w-56 truncate" title={n.plan_of_action || ''}>{n.plan_of_action || '—'}</TableCell>
              <TableCell>{who(n.created_by)}</TableCell>
              <TableCell>{n.is_urgent ? <Badge variant="destructive">Urgent</Badge> : '—'}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function NeedsCustomer({ onLink, linking }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-8 text-center">
      <p className="text-sm text-muted-foreground">These details are stored on the customer. This enquiry is not linked to one yet.</p>
      <Button size="sm" onClick={onLink} disabled={linking}>{linking ? 'Linking…' : 'Save to customer'}</Button>
    </div>
  );
}

const TAB_CLASS = 'gap-1.5';

// Used by the enquiry overlay. `ensureCustomer()` links/creates the customer and returns its id.
export function EnquiryTabs({ lead, users, salesProducts, sourceOptions, router, ensureCustomer, activitiesSlot }) {
  const [customerId, setCustomerId] = useState(lead.converted_customer_id || null);
  const [linking, setLinking] = useState(false);
  useEffect(() => { setCustomerId(lead.converted_customer_id || null); }, [lead.converted_customer_id]);
  async function link() {
    setLinking(true);
    try { const id = await ensureCustomer(); if (id) setCustomerId(id); } catch (err) { showToast(err.message, 'error'); } finally { setLinking(false); }
  }
  const gate = node => (customerId ? node : <NeedsCustomer onLink={link} linking={linking} />);
  return (
    <Tabs defaultValue="profile" className="min-w-0">
      <div className="overflow-x-auto pb-1">
        <TabsList variant="line" className="w-max">
          <TabsTrigger value="profile" className={TAB_CLASS}><IdCardIcon className="size-3.5" />Profile &amp; Others</TabsTrigger>
          <TabsTrigger value="contacts" className={TAB_CLASS}><UserRoundIcon className="size-3.5" />Contacts</TabsTrigger>
          <TabsTrigger value="address" className={TAB_CLASS}><MapPinIcon className="size-3.5" />Address</TabsTrigger>
          <TabsTrigger value="statutory" className={TAB_CLASS}><ScaleIcon className="size-3.5" />Statutory</TabsTrigger>
          <TabsTrigger value="competitors" className={TAB_CLASS}><SwordsIcon className="size-3.5" />Competitors</TabsTrigger>
          <TabsTrigger value="products" className={TAB_CLASS}><PackageIcon className="size-3.5" />Products</TabsTrigger>
          <TabsTrigger value="activities" className={TAB_CLASS}><ActivityIcon className="size-3.5" />Activities &amp; Plan</TabsTrigger>
          <TabsTrigger value="business" className={TAB_CLASS}><BriefcaseIcon className="size-3.5" />Business Details</TabsTrigger>
          <TabsTrigger value="followup" className={TAB_CLASS}><CalendarClockIcon className="size-3.5" />Follow Up</TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="profile" className="pt-2"><ProfileTab lead={lead} router={router} users={users} sourceOptions={sourceOptions} /></TabsContent>
      <TabsContent value="contacts" className="pt-2">{gate(<ContactsTab customerId={customerId} />)}</TabsContent>
      <TabsContent value="address" className="pt-2">{gate(<AddressTab customerId={customerId} />)}</TabsContent>
      <TabsContent value="statutory" className="pt-2">{gate(<CustomerFieldsForm customerId={customerId} fields={STATUTORY} />)}</TabsContent>
      <TabsContent value="competitors" className="pt-2"><CompetitorsTab customerId={customerId} leadId={lead.id} /></TabsContent>
      <TabsContent value="products" className="pt-2"><ProductsTab lead={lead} salesProducts={salesProducts} router={router} /></TabsContent>
      <TabsContent value="activities" className="pt-2">{activitiesSlot}</TabsContent>
      <TabsContent value="business" className="pt-2">{gate(<CustomerFieldsForm customerId={customerId} fields={BUSINESS} />)}</TabsContent>
      <TabsContent value="followup" className="pt-2"><FollowUpTab lead={lead} users={users} /></TabsContent>
    </Tabs>
  );
}

// Used by the customer overlay (the customer already exists, so nothing is gated). `overview`
// and `notes` are rendered by the caller (they already exist there).
export function CustomerTabs({ customerId, overview, notes }) {
  return (
    <Tabs defaultValue="overview" className="min-w-0">
      <div className="overflow-x-auto pb-1">
        <TabsList variant="line" className="w-max">
          <TabsTrigger value="overview" className={TAB_CLASS}><ActivityIcon className="size-3.5" />Overview</TabsTrigger>
          <TabsTrigger value="contacts" className={TAB_CLASS}><UserRoundIcon className="size-3.5" />Contacts</TabsTrigger>
          <TabsTrigger value="address" className={TAB_CLASS}><MapPinIcon className="size-3.5" />Address</TabsTrigger>
          <TabsTrigger value="statutory" className={TAB_CLASS}><ScaleIcon className="size-3.5" />Statutory</TabsTrigger>
          <TabsTrigger value="business" className={TAB_CLASS}><BriefcaseIcon className="size-3.5" />Business Details</TabsTrigger>
          <TabsTrigger value="competitors" className={TAB_CLASS}><SwordsIcon className="size-3.5" />Competitors</TabsTrigger>
          <TabsTrigger value="notes" className={TAB_CLASS}><CalendarClockIcon className="size-3.5" />Notes &amp; Portal</TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="overview" className="pt-2">{overview}</TabsContent>
      <TabsContent value="contacts" className="pt-2"><ContactsTab customerId={customerId} /></TabsContent>
      <TabsContent value="address" className="pt-2"><AddressTab customerId={customerId} /></TabsContent>
      <TabsContent value="statutory" className="pt-2"><CustomerFieldsForm customerId={customerId} fields={STATUTORY} /></TabsContent>
      <TabsContent value="business" className="pt-2"><CustomerFieldsForm customerId={customerId} fields={BUSINESS} /></TabsContent>
      <TabsContent value="competitors" className="pt-2"><CompetitorsTab customerId={customerId} /></TabsContent>
      <TabsContent value="notes" className="pt-2">{notes}</TabsContent>
    </Tabs>
  );
}

// Editable customer header: the basic identity fields (saved together).
export function CustomerHeaderForm({ detail, onSaved }) {
  const KEYS = ['name', 'phone', 'email', 'website', 'address', 'city', 'state', 'pin_code'];
  const init = () => Object.fromEntries(KEYS.map(k => [k, detail[k] ?? '']));
  const [v, setV] = useState(init);
  const [saving, setSaving] = useState(false);
  useEffect(() => { setV(init()); }, [detail.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = KEYS.some(k => (v[k] ?? '') !== (detail[k] ?? ''));
  async function save() {
    if (!String(v.name).trim()) return showToast('Name is required', 'error');
    setSaving(true);
    try {
      await api(`/api/customers/${detail.id}`, { method: 'PATCH', body: Object.fromEntries(KEYS.map(k => [k, v[k]])) });
      showToast('Customer saved'); onSaved?.();
    } catch (err) { showToast(err.message, 'error'); } finally { setSaving(false); }
  }
  const F = ({ k, label, span }) => (
    <div className={`grid gap-1 ${span || ''}`}><Label className="text-xs text-muted-foreground">{label}</Label>
      <Input className="h-8" value={v[k] ?? ''} onChange={e => setV(x => ({ ...x, [k]: e.target.value }))} /></div>
  );
  return (
    <div className="rounded-lg border p-3">
      <div className="grid gap-x-4 gap-y-2.5 sm:grid-cols-2 lg:grid-cols-4">
        <F k="name" label="Customer name" span="lg:col-span-2" /><F k="phone" label="Phone" /><F k="email" label="Email" />
        <F k="website" label="Web address" span="lg:col-span-2" /><F k="address" label="Address" span="lg:col-span-2" />
        <F k="city" label="City / District" /><F k="state" label="State" /><F k="pin_code" label="Pin code" />
      </div>
      <SaveBar onSave={save} saving={saving} dirty={dirty} />
    </div>
  );
}
