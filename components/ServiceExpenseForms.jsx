'use client';

// New Cash Request / Travel Allowance forms (a wide Sheet each), mirroring the paper forms.
// Totals, the Tour Summary and "in words" are computed live by lib/service-expense.mjs — the same
// code the server re-runs on save.
import { useEffect, useRef, useState } from 'react';
import { PlusIcon, XIcon, TrashIcon, UserPlusIcon } from 'lucide-react';
import { api, showToast } from '@/lib/client';
import { todayISO } from '@/lib/date';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from '@/components/ui/sheet';
import SearchableSelect from '@/components/SearchableSelect';
import { SummaryTable, inr } from '@/components/ServiceExpenseDetail';
import { amountInWords, sumRows, tourSummary, money } from '@/lib/service-expense.mjs';

// One or many customers: search real customers + registered "other" names; unknown names can be
// added as "other" (saved server-side so they appear in later searches).
function CustomerField({ value, onChange, multiple }) {
  const [text, setText] = useState('');
  const cache = useRef({});
  async function search(q) {
    const rows = await api(`/api/service-customers?search=${encodeURIComponent(q)}`);
    return rows.map(c => { const v = `${c.type}:${c.id}`; cache.current[v] = c; return { value: v, label: c.label }; });
  }
  const add = c => {
    const chip = { type: c.type, id: c.type === 'db' ? c.id : undefined, name: c.name };
    onChange(multiple ? (value.some(x => x.name.toLowerCase() === c.name.toLowerCase()) ? value : [...value, chip]) : [chip]);
    setText('');
  };
  async function addOther() {
    const name = text.trim();
    if (!name) return;
    try { await api('/api/service-customers', { method: 'POST', body: { name } }); add({ type: 'other', name }); } catch (err) { showToast(err.message, 'error'); }
  }
  return (
    <div className="grid gap-2">
      <SearchableSelect value="" options={[]} asyncOptions={search} displayValue={text} onTextChange={setText}
        onChange={v => cache.current[v] && add(cache.current[v])} placeholder={multiple ? 'Search customers, or type a new name…' : 'Search customer, or type a new name…'} />
      {text.trim().length > 0 && (
        <button type="button" onClick={addOther} className="flex w-fit items-center gap-1.5 rounded-md border border-dashed px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted/40">
          <UserPlusIcon className="size-3.5" />Add “{text.trim()}” as other customer
        </button>
      )}
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map(c => (
            <Badge key={c.name} variant="secondary" className="gap-1 pr-1">
              {c.name}{c.type === 'other' && <span className="text-muted-foreground">(other)</span>}
              <button type="button" onClick={() => onChange(value.filter(x => x.name !== c.name))} className="rounded hover:bg-background/60"><XIcon className="size-3" /></button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

// Editable table with a Total row for its money column.
function RowsTable({ title, cols, rows, onChange, listId }) {
  const blank = () => Object.fromEntries(cols.map(c => [c.key, '']));
  const setCell = (i, k, v) => onChange(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  return (
    <div className="rounded-lg border">
      <div className="flex items-center justify-between border-b bg-muted/30 px-3 py-1.5">
        <span className="text-sm font-medium">{title}</span>
        <Button type="button" size="sm" variant="ghost" onClick={() => onChange([...rows, blank()])}><PlusIcon data-icon="inline-start" />Add row</Button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-max text-sm">
          <thead><tr className="text-left text-xs text-muted-foreground">
            {cols.map(c => <th key={c.key} className={`px-2 py-1.5 font-normal ${c.w || ''}`}>{c.label}</th>)}<th />
          </tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t">
                {cols.map(c => (
                  <td key={c.key} className="px-1.5 py-1">
                    <Input type={c.type || 'text'} value={r[c.key] ?? ''} min={c.type === 'number' ? 0 : undefined} step={c.type === 'number' ? 'any' : undefined}
                      list={c.list ? `${listId}-${c.key}` : undefined} className={`h-8 ${c.type === 'number' ? 'text-right' : ''}`} onChange={e => setCell(i, c.key, e.target.value)} />
                    {c.list && <datalist id={`${listId}-${c.key}`}>{c.list.map(o => <option key={o} value={o} />)}</datalist>}
                  </td>
                ))}
                <td className="px-1"><Button type="button" size="icon" variant="ghost" className="size-7" onClick={() => onChange(rows.filter((_, j) => j !== i))}><TrashIcon className="size-3.5" /></Button></td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr className="border-t bg-muted/20 font-medium">
            <td colSpan={cols.length - 1} className="px-3 py-1.5 text-right">Total</td>
            <td className="px-3 py-1.5 text-right tabular-nums">{inr(sumRows(rows))}</td><td />
          </tr></tfoot>
        </table>
      </div>
    </div>
  );
}

function Shell({ title, onClose, onSave, saving, children }) {
  return (
    <Sheet open onOpenChange={o => !o && onClose()}>
      <SheetContent className="w-full data-[side=right]:sm:max-w-5xl">
        <SheetHeader><SheetTitle>{title}</SheetTitle></SheetHeader>
        <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4">{children}</div>
        <SheetFooter className="flex-row justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={onSave} disabled={saving}>{saving ? 'Submitting…' : 'Submit for approval'}</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

async function submit(body, setSaving, onSaved) {
  setSaving(true);
  try { const r = await api('/api/service-expenses', { method: 'POST', body }); showToast(`${r.req_no} submitted to your Manager`); onSaved(); }
  catch (err) { showToast(err.message, 'error'); setSaving(false); }
}

export function CashForm({ user, onClose, onSaved }) {
  const [f, setF] = useState({ date: todayISO(), amount: '', purpose: '', customers: [] });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  return (
    <Shell title="Cash requisition for sundry expenses" onClose={onClose} saving={saving} onSave={() => submit({ ...f, kind: 'cash' }, setSaving, onSaved)}>
      <div className="grid gap-4 rounded-lg border p-4 sm:grid-cols-2">
        <div className="grid gap-1.5"><Label>Date</Label><Input type="date" value={f.date} onChange={e => set('date', e.target.value)} /></div>
        <div className="grid gap-1.5"><Label>Requested by</Label><Input value={user.display_name || user.username} disabled /></div>
        <div className="grid gap-1.5"><Label>Amount (Rs)</Label><Input type="number" min="0" step="any" value={f.amount} onChange={e => set('amount', e.target.value)} className="text-right" />
          {money(f.amount) > 0 && <span className="text-xs text-muted-foreground">{amountInWords(f.amount)}</span>}</div>
        <div className="grid gap-1.5"><Label>Purpose</Label><Textarea rows={2} value={f.purpose} onChange={e => set('purpose', e.target.value)} /></div>
        <div className="grid gap-1.5 sm:col-span-2"><Label>Customers</Label><CustomerField multiple value={f.customers} onChange={v => set('customers', v)} />
          <span className="text-xs text-muted-foreground">One request can cover several customers; it can later be taken as advance on a travel claim for any of them.</span></div>
      </div>
      <p className="text-xs text-muted-foreground">Authorized by is filled in automatically once your Manager and the Executive approve. Accounts fills the “for Accounts use” section.</p>
    </Shell>
  );
}

const MODES = ['Train', 'Bus', 'Flight', 'Car', 'Bike', 'Auto', 'Taxi'];
const CLASSES = ['AC', 'Non-AC', 'Sleeper', 'General', 'Economy'];

export function TravelForm({ user, onClose, onSaved }) {
  const [f, setF] = useState({ date: todayISO(), purpose: '', place: null, party_name: '', chargeable: 'yes', remarks: '',
    travel: [{}], lodging: [{}], boarding: [{}], conveyance: [{}], other: [{}] });
  const [suggest, setSuggest] = useState([]);
  const [cands, setCands] = useState([]);
  const [picked, setPicked] = useState([]);
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));

  useEffect(() => { api('/api/service-expenses/suggestions').then(setSuggest).catch(() => {}); }, []);
  useEffect(() => {
    if (!f.place) { setCands([]); setPicked([]); return; }
    api(`/api/service-expenses/advances?customer=${encodeURIComponent(f.place.name)}`)
      .then(rows => { setCands(rows); setPicked(rows.map(r => r.id)); }).catch(() => {});
  }, [f.place?.name]);

  const advance = cands.filter(c => picked.includes(c.id)).reduce((s, c) => s + Number(c.amount), 0);
  const summary = tourSummary(f, advance);
  const T = (key, label, w, type) => ({ key, label, w, type });
  return (
    <Shell title="Travelling expenses bill" onClose={onClose} saving={saving}
      onSave={() => submit({ ...f, kind: 'travel', party_name: f.party_name || f.place?.name || '', advance_ids: picked }, setSaving, onSaved)}>
      <div className="grid gap-4 rounded-lg border p-4 sm:grid-cols-2">
        <div className="grid gap-1.5"><Label>Name</Label><Input value={user.display_name || user.username} disabled /></div>
        <div className="grid gap-1.5"><Label>Date</Label><Input type="date" value={f.date} onChange={e => set('date', e.target.value)} /></div>
        <div className="grid gap-1.5"><Label>Purpose of visit</Label>
          <SearchableSelect value="" options={suggest.map(s => ({ value: s, label: s }))} displayValue={f.purpose} onTextChange={v => set('purpose', v)} onChange={v => set('purpose', v)} placeholder="Type, or pick one of your visit descriptions" /></div>
        <div className="grid gap-1.5"><Label>Place of visit (customer)</Label><CustomerField value={f.place ? [f.place] : []} onChange={v => set('place', v[0] || null)} /></div>
      </div>

      {f.place && cands.length > 0 && (
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
          <div className="mb-2 text-sm font-medium">Advance available for {f.place.name}: {inr(cands.reduce((s, c) => s + Number(c.amount), 0))}</div>
          <div className="grid gap-1.5">
            {cands.map(c => (
              <label key={c.id} className="flex cursor-pointer items-center gap-2 text-sm">
                <Checkbox checked={picked.includes(c.id)} onCheckedChange={() => setPicked(p => (p.includes(c.id) ? p.filter(x => x !== c.id) : [...p, c.id]))} />
                <span className="font-medium">{c.req_no}</span><span>{inr(c.amount)}</span>
                <span className="truncate text-muted-foreground">{c.purpose}{c.shared.length > 0 && ` (shared: ${c.shared.join(', ')})`}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      <RowsTable title="1. Travel details" listId="tv" rows={f.travel} onChange={v => set('travel', v)} cols={[
        T('dep_date', 'Dep. date', 'w-36', 'date'), T('dep_time', 'Time', 'w-28', 'time'), T('dep_place', 'From place', 'w-40'),
        T('arr_date', 'Arr. date', 'w-36', 'date'), T('arr_time', 'Time', 'w-28', 'time'), T('arr_place', 'To place', 'w-40'),
        { ...T('mode', 'Mode', 'w-28'), list: MODES }, { ...T('class', 'Class', 'w-28'), list: CLASSES }, T('amount', 'Amount (Rs)', 'w-28', 'number')]} />
      <div className="grid gap-4 lg:grid-cols-2">
        <RowsTable title="2. Lodging" listId="lg" rows={f.lodging} onChange={v => set('lodging', v)} cols={[T('date', 'Date', '', 'date'), T('amount', 'Amount (Rs)', 'w-28', 'number')]} />
        <RowsTable title="3. Boarding / journey allowance" listId="bd" rows={f.boarding} onChange={v => set('boarding', v)} cols={[T('date', 'Date', '', 'date'), T('place', 'Place'), T('amount', 'Amount (Rs)', 'w-28', 'number')]} />
      </div>
      <RowsTable title="4. Conveyance expenses" listId="cv" rows={f.conveyance} onChange={v => set('conveyance', v)} cols={[
        T('date', 'Date', 'w-36', 'date'), T('from', 'From'), T('to', 'To'), { ...T('mode', 'Mode of transport', 'w-36'), list: MODES }, T('km', 'Km', 'w-20', 'number'), T('amount', 'Amount (Rs)', 'w-28', 'number')]} />
      <RowsTable title="5. Other expenses" listId="ot" rows={f.other} onChange={v => set('other', v)} cols={[
        T('date', 'Date', 'w-36', 'date'), T('type', 'Type of expense'), T('particulars', 'Particulars'), T('amount', 'Amount (Rs)', 'w-28', 'number')]} />

      <div className="grid gap-4 rounded-lg border p-4 sm:grid-cols-2">
        <div className="grid gap-1.5"><Label>6. Chargeable?</Label>
          <div className="flex gap-2">{[['yes', 'Chargeable'], ['no', 'Not chargeable']].map(([k, l]) => (
            <Button key={k} type="button" variant={f.chargeable === k ? 'default' : 'outline'} className="flex-1" onClick={() => set('chargeable', k)}>{l}</Button>))}</div></div>
        <div className="grid gap-1.5"><Label>7. Party name</Label><Input value={f.party_name || f.place?.name || ''} onChange={e => set('party_name', e.target.value)} /></div>
        <div className="grid gap-1.5 sm:col-span-2"><Label>8. Remarks</Label><Textarea rows={2} value={f.remarks} onChange={e => set('remarks', e.target.value)} /></div>
      </div>

      <SummaryTable summary={summary} />
    </Shell>
  );
}
