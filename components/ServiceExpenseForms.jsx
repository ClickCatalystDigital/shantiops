'use client';

// New Cash Request / Travel Allowance forms (a wide Sheet each), mirroring the paper forms.
// Totals, the Tour Summary and "in words" are computed live by lib/service-expense.mjs — the same
// code the server re-runs on save.
import { useEffect, useRef, useState } from 'react';
import { PlusIcon, XIcon, TrashIcon, UserPlusIcon, PaperclipIcon, FileTextIcon, ChevronsUpDownIcon, Loader2Icon } from 'lucide-react';
import { api, showToast } from '@/lib/client';
import { todayISO } from '@/lib/date';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from '@/components/ui/sheet';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import SearchableSelect from '@/components/SearchableSelect';
import AutoTextarea from '@/components/AutoTextarea';
import { compressImage } from '@/lib/image-compress';
import { SummaryTable, inr } from '@/components/ServiceExpenseDetail';
import { amountInWords, sumRows, tourSummary, money, allocateAdvance } from '@/lib/service-expense.mjs';

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

// One numbered card of the travel bill, with its running total.
function Section({ n, title, total, children }) {
  return (
    <section className="rounded-2xl border bg-card p-3.5 shadow-xs sm:p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold"><span className="grid size-5 place-items-center rounded-full bg-primary/10 text-[11px] text-primary">{n}</span>{title}</h3>
        {total != null && <span className="text-xs tabular-nums text-muted-foreground">{inr(total)}</span>}
      </div>
      {children}
    </section>
  );
}

// Receipts for a section: pick photos or PDFs (phone gallery / camera / files, or the computer's files).
// Each is uploaded straight away (photos shrunk first); the claim carries the returned { key, name, type, size }.
function Attachments({ items, onChange, onBusy }) {
  const input = useRef(null);
  const [n, setN] = useState(0);
  async function pick(e) {
    const files = [...(e.target.files || [])];
    e.target.value = '';
    if (!files.length) return;
    setN(c => c + files.length); onBusy(1);
    const added = [];
    for (const f of files) {
      try {
        const file = f.type.startsWith('image/') ? await compressImage(f) : f;
        const fd = new FormData();
        fd.append('file', file);
        added.push(await api('/api/service-expenses/attachments', { method: 'POST', body: fd }));
      } catch (err) { showToast(`${f.name}: ${err.message}`, 'error'); }
    }
    onChange([...items, ...added]);
    setN(c => c - files.length); onBusy(-1);
  }
  return (
    <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t pt-3">
      <input ref={input} type="file" multiple accept="image/*,application/pdf" className="hidden" onChange={pick} />
      <Button type="button" size="sm" variant="outline" className="h-7 rounded-full text-xs" onClick={() => input.current.click()}><PaperclipIcon data-icon="inline-start" />Attach photo / PDF</Button>
      {items.map(a => (
        <Badge key={a.key} variant="secondary" className="max-w-48 gap-1 pr-1">
          <FileTextIcon className="size-3 shrink-0" /><span className="truncate">{a.name}</span>
          <button type="button" onClick={() => onChange(items.filter(x => x.key !== a.key))} className="rounded hover:bg-background/60" aria-label="Remove"><XIcon className="size-3" /></button>
        </Badge>
      ))}
      {n > 0 && <span className="flex items-center gap-1 text-xs text-muted-foreground"><Loader2Icon className="size-3 animate-spin" />Uploading…</span>}
    </div>
  );
}

// Editable rows: a table on desktop, one card per row on a phone. Text boxes grow as the text wraps.
function RowsSection({ n, title, cols, rows, onChange, listId, attachments, onAttach, onBusy }) {
  const blank = () => Object.fromEntries(cols.map(c => [c.key, '']));
  const setCell = (i, k, v) => onChange(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const del = i => onChange(rows.filter((_, j) => j !== i));
  const cell = (r, i, c) => {
    const common = { value: r[c.key] ?? '', onChange: e => setCell(i, c.key, e.target.value) };
    if (c.type === 'number') return <Input type="number" min={0} step="any" inputMode="decimal" className="h-9 text-right md:h-8" {...common} />;
    if (c.type === 'date' || c.type === 'time') return <Input type={c.type} className="h-9 md:h-8" {...common} />;
    if (c.list) return <><Input list={`${listId}-${c.key}`} className="h-9 md:h-8" {...common} /><datalist id={`${listId}-${c.key}`}>{c.list.map(o => <option key={o} value={o} />)}</datalist></>;
    return <AutoTextarea {...common} />;
  };
  return (
    <Section n={n} title={title} total={sumRows(rows)}>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-max text-sm">
          <thead><tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
            {cols.map(c => <th key={c.key} className={`px-1.5 pb-1.5 font-medium ${c.w || ''}`}>{c.label}</th>)}<th /></tr></thead>
          <tbody>{rows.map((r, i) => (
            <tr key={i} className="align-top">
              {cols.map(c => <td key={c.key} className="px-1 py-1">{cell(r, i, c)}</td>)}
              <td className="px-1 py-1"><Button type="button" size="icon" variant="ghost" className="size-8" onClick={() => del(i)} aria-label="Remove row"><TrashIcon className="size-3.5" /></Button></td>
            </tr>))}
          </tbody>
        </table>
      </div>
      <div className="grid gap-2.5 md:hidden">
        {rows.map((r, i) => (
          <div key={i} className="rounded-xl border bg-muted/20 p-3">
            <div className="mb-2 flex items-center justify-between"><span className="text-xs font-medium text-muted-foreground">Entry {i + 1}</span>
              <Button type="button" size="icon" variant="ghost" className="size-7" onClick={() => del(i)} aria-label="Remove row"><TrashIcon className="size-3.5" /></Button></div>
            <div className="grid grid-cols-2 gap-2">
              {cols.map(c => (
                <div key={c.key} className={`grid gap-1 ${['date', 'time', 'number'].includes(c.type) ? '' : 'col-span-2'}`}>
                  <Label className="text-[11px] text-muted-foreground">{c.label}</Label>{cell(r, i, c)}
                </div>))}
            </div>
          </div>))}
      </div>
      <Button type="button" size="sm" variant="ghost" className="mt-2 text-muted-foreground" onClick={() => onChange([...rows, blank()])}><PlusIcon data-icon="inline-start" />Add row</Button>
      <Attachments items={attachments} onChange={onAttach} onBusy={onBusy} />
    </Section>
  );
}

function Shell({ title, onClose, onSave, saving, busy, summary, children }) {
  return (
    <Sheet open onOpenChange={o => !o && onClose()}>
      <SheetContent className="w-full gap-0 data-[side=right]:sm:max-w-4xl">
        <SheetHeader className="border-b"><SheetTitle>{title}</SheetTitle></SheetHeader>
        <div className="flex flex-1 flex-col gap-3.5 overflow-y-auto bg-muted/20 p-3 sm:p-4">{children}</div>
        <SheetFooter className="flex-row items-center gap-2 border-t bg-background">
          {summary && <div className="mr-auto min-w-0 text-xs leading-tight"><div className="text-muted-foreground">{summary[0]}</div><div className="truncate text-sm font-semibold tabular-nums">{summary[1]}</div></div>}
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={onSave} disabled={saving || busy}>{saving ? 'Submitting…' : busy ? 'Uploading…' : 'Submit for approval'}</Button>
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
    <Shell title="Cash requisition for sundry expenses" onClose={onClose} saving={saving} summary={money(f.amount) > 0 ? ['Requesting', inr(f.amount)] : null} onSave={() => submit({ ...f, kind: 'cash' }, setSaving, onSaved)}>
      <div className="grid gap-4 rounded-2xl border bg-card p-4 shadow-xs sm:grid-cols-2">
        <div className="grid gap-1.5"><Label>Date</Label><Input type="date" className="h-9" value={f.date} onChange={e => set('date', e.target.value)} /></div>
        <div className="grid gap-1.5"><Label>Requested by</Label><Input className="h-9" value={user.display_name || user.username} disabled /></div>
        <div className="grid gap-1.5"><Label>Amount (Rs)</Label><Input type="number" inputMode="decimal" min="0" step="any" className="h-9 text-right" value={f.amount} onChange={e => set('amount', e.target.value)} />
          {money(f.amount) > 0 && <span className="text-xs text-muted-foreground">{amountInWords(f.amount)}</span>}</div>
        <div className="grid gap-1.5"><Label>Purpose</Label><AutoTextarea className="min-h-9" value={f.purpose} onChange={e => set('purpose', e.target.value)} /></div>
        <div className="grid gap-1.5 sm:col-span-2"><Label>Customers</Label><CustomerField multiple value={f.customers} onChange={v => set('customers', v)} />
          <span className="text-xs text-muted-foreground">One request can cover several customers. Its money can later be taken as advance on travel claims, a part at a time.</span></div>
      </div>
      <p className="text-xs text-muted-foreground">Authorized by is filled in automatically once your Manager and the Executive approve. Accounts fills the “for Accounts use” section.</p>
    </Shell>
  );
}

const MODES = ['Train', 'Bus', 'Flight', 'Car', 'Bike', 'Auto', 'Taxi'];
const CLASSES = ['AC', 'Non-AC', 'Sleeper', 'General', 'Economy'];

// "Advance taken" block above the Tour Summary: the amount is typed (or filled from the cash requests
// picked here); each cash request shows what is left on it after claims it already funds.
function AdvanceCell({ advance, onAdvance, cands, picked, onPick }) {
  const chosen = picked.map(id => cands.find(c => c.id === id)).filter(Boolean);
  const alloc = allocateAdvance(money(advance), chosen);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        {cands.length > 0 && (
          <Popover>
            <PopoverTrigger asChild><Button type="button" variant="outline" size="sm" className="h-9 shrink-0 gap-1 text-xs">{picked.length ? `${picked.length} CR linked` : 'Link CR'}<ChevronsUpDownIcon className="size-3 opacity-60" /></Button></PopoverTrigger>
            <PopoverContent align="end" className="w-80 p-2">
              <div className="mb-1 px-1 text-xs text-muted-foreground">Cash requests with money left</div>
              {cands.map(c => (
                <label key={c.id} className="flex cursor-pointer items-start gap-2 rounded-lg p-2 text-sm hover:bg-muted/50">
                  <Checkbox className="mt-0.5" checked={picked.includes(c.id)} onCheckedChange={() => onPick(c.id)} />
                  <span className="min-w-0 flex-1">
                    <span className="flex justify-between gap-2"><b>{c.req_no}</b><span className="tabular-nums">{inr(c.remaining)} left</span></span>
                    <span className="block text-xs text-muted-foreground">
                      {inr(c.amount)}{c.applied.length > 0 && ` − ${c.applied.map(a => `${a.req_no} ${inr(a.amount)}`).join(', ')}`} · {c.purpose}
                    </span>
                  </span>
                </label>))}
            </PopoverContent>
          </Popover>)}
        <Input type="number" inputMode="decimal" min="0" step="any" placeholder="Amount (Rs) — type, or link a cash request" className="h-9 flex-1 text-right" value={advance} onChange={e => onAdvance(e.target.value)} />
      </div>
      {chosen.length > 0 && money(advance) > 0 && (
        <p className="text-xs leading-snug text-muted-foreground">
          {alloc.links.map(l => `${chosen.find(c => c.id === l.cash_id).req_no} ${inr(l.amount)}`).join(' + ')}
          {alloc.other > 0 && ` + ${inr(alloc.other)} not from a cash request`}
        </p>)}
    </div>
  );
}

export function TravelForm({ user, onClose, onSaved }) {
  const [f, setF] = useState({ date: todayISO(), purpose: '', place: null, party_name: '', chargeable: 'yes', remarks: '',
    travel: [{}], lodging: [{}], boarding: [{}], conveyance: [{}], other: [{}] });
  const [att, setAtt] = useState({});
  const [busy, setBusy] = useState(0);
  const [suggest, setSuggest] = useState([]);
  const [cands, setCands] = useState([]);
  const [picked, setPicked] = useState([]);
  const [advance, setAdvance] = useState('');
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));

  useEffect(() => { api('/api/service-expenses/suggestions').then(setSuggest).catch(() => {}); }, []);
  useEffect(() => {
    api(`/api/service-expenses/advances?customer=${encodeURIComponent(f.place?.name || '')}`).then(rows => { setCands(rows); setPicked(p => p.filter(id => rows.some(r => r.id === id))); }).catch(() => {});
  }, [f.place?.name]);
  // Linking cash requests fills the advance with what is left on them; the user may then change it.
  function pick(id) {
    const next = picked.includes(id) ? picked.filter(x => x !== id) : [...picked, id];
    setPicked(next);
    const sum = next.reduce((t, i) => t + Number(cands.find(c => c.id === i)?.remaining || 0), 0);
    setAdvance(sum ? String(Math.round(sum * 100) / 100) : '');
  }

  const summary = tourSummary(f, advance);
  const T = (key, label, w, type) => ({ key, label, w, type });
  const sec = (key, n, title, cols, listId) => (
    <RowsSection key={key} n={n} title={title} listId={listId} cols={cols} rows={f[key]} onChange={v => set(key, v)}
      attachments={att[key] || []} onAttach={v => setAtt(a => ({ ...a, [key]: v }))} onBusy={d => setBusy(b => b + d)} />
  );
  return (
    <Shell title="Travelling expenses bill" onClose={onClose} saving={saving} busy={busy > 0}
      summary={[summary.balance < 0 ? 'Payable to company' : 'Payable to you', inr(Math.abs(summary.balance))]}
      onSave={() => submit({ ...f, kind: 'travel', party_name: f.party_name || f.place?.name || '', advance: money(advance), advance_ids: picked, attachments: att }, setSaving, onSaved)}>
      <div className="grid gap-4 rounded-2xl border bg-card p-4 shadow-xs sm:grid-cols-2">
        <div className="grid gap-1.5"><Label>Name</Label><Input className="h-9" value={user.display_name || user.username} disabled /></div>
        <div className="grid gap-1.5"><Label>Date</Label><Input type="date" className="h-9" value={f.date} onChange={e => set('date', e.target.value)} /></div>
        <div className="grid gap-1.5"><Label>Purpose of visit</Label>
          <SearchableSelect value="" options={suggest.map(s => ({ value: s, label: s }))} displayValue={f.purpose} onTextChange={v => set('purpose', v)} onChange={v => set('purpose', v)} placeholder="Type, or pick one of your visit descriptions" /></div>
        <div className="grid gap-1.5"><Label>Place of visit (customer)</Label><CustomerField value={f.place ? [f.place] : []} onChange={v => set('place', v[0] || null)} /></div>
      </div>

      {sec('travel', 1, 'Travel details', [
        T('dep_date', 'Dep. date', 'w-36', 'date'), T('dep_time', 'Time', 'w-28', 'time'), T('dep_place', 'From place', 'w-40'),
        T('arr_date', 'Arr. date', 'w-36', 'date'), T('arr_time', 'Time', 'w-28', 'time'), T('arr_place', 'To place', 'w-40'),
        { ...T('mode', 'Mode', 'w-28'), list: MODES }, { ...T('class', 'Class', 'w-28'), list: CLASSES }, T('amount', 'Amount (Rs)', 'w-28', 'number')], 'tv')}
      {sec('lodging', 2, 'Lodging', [T('date', 'Date', 'w-40', 'date'), T('amount', 'Amount (Rs)', 'w-32', 'number')], 'lg')}
      {sec('boarding', 3, 'Boarding / journey allowance', [T('date', 'Date', 'w-40', 'date'), T('place', 'Place'), T('amount', 'Amount (Rs)', 'w-32', 'number')], 'bd')}
      {sec('conveyance', 4, 'Conveyance expenses', [
        T('date', 'Date', 'w-36', 'date'), T('from', 'From'), T('to', 'To'), { ...T('mode', 'Mode of transport', 'w-36'), list: MODES }, T('km', 'Km', 'w-20', 'number'), T('amount', 'Amount (Rs)', 'w-28', 'number')], 'cv')}
      {sec('other', 5, 'Other expenses', [T('date', 'Date', 'w-36', 'date'), T('type', 'Type of expense'), T('particulars', 'Particulars'), T('amount', 'Amount (Rs)', 'w-28', 'number')], 'ot')}

      <div className="grid gap-4 rounded-2xl border bg-card p-4 shadow-xs sm:grid-cols-2">
        <div className="grid gap-1.5"><Label>6. Chargeable?</Label>
          <div className="flex gap-2">{[['yes', 'Chargeable'], ['no', 'Not chargeable']].map(([k, l]) => (
            <Button key={k} type="button" variant={f.chargeable === k ? 'default' : 'outline'} className="h-9 flex-1" onClick={() => set('chargeable', k)}>{l}</Button>))}</div></div>
        <div className="grid gap-1.5"><Label>7. Party name</Label><AutoTextarea className="min-h-9" value={f.party_name || f.place?.name || ''} onChange={e => set('party_name', e.target.value)} /></div>
        <div className="grid gap-1.5 sm:col-span-2"><Label>8. Remarks</Label><AutoTextarea className="min-h-9" value={f.remarks} onChange={e => set('remarks', e.target.value)} /></div>
      </div>

      <div className="rounded-2xl border bg-card p-4 shadow-xs">
        <div className="mb-2 text-sm font-semibold">Advance taken</div>
        <AdvanceCell advance={advance} onAdvance={setAdvance} cands={cands} picked={picked} onPick={pick} />
      </div>
      <SummaryTable summary={summary} />
    </Shell>
  );
}
