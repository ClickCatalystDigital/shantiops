'use client';

// components/SalesExtras.jsx — Sales Mantra parity tabs (SYSTEM.md §5dr): Weekly Planner and Library.
// (AMC lives in components/SalesAmc.jsx.) Each tab fetches its own data, so app/sales/page.js is untouched.
import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardAction } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ChevronLeftIcon, ChevronRightIcon, DownloadIcon, Trash2Icon, UploadIcon } from 'lucide-react';
import { api, showToast } from '@/lib/client';
import { todayISO } from '@/lib/date';
import { formatDate } from '@/lib/format';
import { weekOf } from '@/lib/sales-insights.mjs';
import { personLabel } from '@/lib/sales-people.mjs';
import { actionTypeLabel } from '@/lib/action-types.mjs';

const addDays = (iso, n) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const DAY = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: '2-digit', month: 'short', timeZone: 'UTC' });

// ── Weekly Planner ────────────────────────────────────────────────────────────────────────────────
// One week of planned follow-ups (Diary "next plan" dates) plus the overdue ones. Move a follow-up to
// another day; the Sales Head can also hand it to someone else (the new owner gets a notification).
export function WeeklyPlannerTab({ users = [], isSalesHead }) {
  const today = todayISO();
  const [start, setStart] = useState(weekOf(today));
  const [rows, setRows] = useState(null);
  const [who, setWho] = useState('all');
  const end = addDays(start, 6);

  const load = useCallback(() => {
    setRows(null);
    api(`/api/crm-notes/planner?from=${start}&to=${end}`).then(setRows).catch(e => { showToast(e.message, 'error'); setRows([]); });
  }, [start, end]);
  useEffect(load, [load]);

  async function patch(row, body) {
    try { await api(`/api/crm-notes/${row.id}`, { method: 'PATCH', body }); load(); }
    catch (e) { showToast(e.message, 'error'); }
  }

  const shown = useMemo(() => (rows || []).filter(r => who === 'all' || (r.plan_for || r.created_by) === who), [rows, who]);
  const overdue = shown.filter(r => r.overdue);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const load_ = useMemo(() => {
    const m = new Map();
    for (const r of rows || []) if (!r.overdue) { const k = r.plan_for || r.created_by || '—'; m.set(k, (m.get(k) || 0) + 1); }
    return [...m].sort((a, b) => b[1] - a[1]);
  }, [rows]);

  const userOpts = [...users];
  const Item = ({ r }) => (
    <div className="flex flex-col gap-1.5 rounded-md border bg-card p-2 text-sm">
      <div className="flex items-start justify-between gap-2">
        <span className="font-medium leading-tight">{r.org || 'Enquiry'}</span>
        {r.plan_time && <span className="shrink-0 text-xs tnum text-muted-foreground">{r.plan_time}</span>}
      </div>
      <div className="text-xs text-muted-foreground">
        {r.plan_note_type ? `${actionTypeLabel(r.plan_note_type)} · ` : ''}{r.plan_of_action || 'Follow-up'}{r.contact_name ? ` · ${r.contact_name}` : ''}{r.phone ? ` · ${r.phone}` : ''}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Input type="date" className="h-7 w-[8.5rem] px-1.5 text-xs" value={r.date} onChange={e => e.target.value && patch(r, { next_plan_date: e.target.value })} />
        {isSalesHead ? (
          <Select value={r.plan_for || '_none'} onValueChange={v => patch(r, { plan_for: v === '_none' ? null : v })}>
            <SelectTrigger className="h-7 w-32 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="_none">Unassigned</SelectItem>
              {userOpts.map(u => <SelectItem key={u.username} value={u.username}>{u.display_name || u.username}</SelectItem>)}
            </SelectContent>
          </Select>
        ) : <Badge variant="outline" className="text-xs">{personLabel(r.plan_for || r.created_by, users)}</Badge>}
      </div>
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>{formatDate(start)} – {formatDate(end)}</CardTitle>
          <CardAction className="flex flex-wrap items-center gap-2">
            {isSalesHead && (
              <Select value={who} onValueChange={setWho}>
                <SelectTrigger className="h-8 w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Everyone</SelectItem>
                  {userOpts.map(u => <SelectItem key={u.username} value={u.username}>{u.display_name || u.username}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
            <Button size="icon" variant="outline" className="size-8" onClick={() => setStart(addDays(start, -7))}><ChevronLeftIcon /></Button>
            <Button size="sm" variant="outline" onClick={() => setStart(weekOf(today))}>This week</Button>
            <Button size="icon" variant="outline" className="size-8" onClick={() => setStart(addDays(start, 7))}><ChevronRightIcon /></Button>
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {isSalesHead && load_.length > 0 && (
            <div className="flex flex-wrap gap-2 text-xs">
              {load_.map(([k, n]) => <Badge key={k} variant="secondary">{personLabel(k, users)}: {n} follow-up{n === 1 ? '' : 's'}</Badge>)}
            </div>
          )}
          {rows === null && <p className="text-sm text-muted-foreground">Loading…</p>}
          {overdue.length > 0 && (
            <div className="rounded-md border border-destructive/40 p-3">
              <div className="mb-2 text-sm font-medium text-destructive">Overdue — {overdue.length} follow-up{overdue.length === 1 ? '' : 's'} not done (no later Diary entry)</div>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{overdue.map(r => <Item key={r.id} r={r} />)}</div>
            </div>
          )}
          <div className="grid gap-3 md:grid-cols-4 xl:grid-cols-7">
            {days.map(d => {
              const items = shown.filter(r => !r.overdue && r.date === d);
              return (
                <div key={d} className={`flex flex-col gap-2 rounded-md border p-2 ${d === today ? 'border-primary' : ''}`}>
                  <div className="text-xs font-semibold text-muted-foreground">{DAY.format(new Date(`${d}T00:00:00Z`))}{d === today ? ' · today' : ''}</div>
                  {items.length === 0 ? <p className="text-xs text-muted-foreground">—</p> : items.map(r => <Item key={r.id} r={r} />)}
                </div>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground">Follow-ups come from the Diary (Plan of Action). Change the date to move one; add new ones from an enquiry's Activities &amp; Plan.</p>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Library ───────────────────────────────────────────────────────────────────────────────────────
const CATEGORIES = [['mailer', 'Mailer'], ['presentation', 'Presentation'], ['price_list', 'Price list'], ['other', 'Other']];
const catLabel = k => CATEGORIES.find(c => c[0] === k)?.[1] || k;
const sizeLabel = n => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round((n || 0) / 1024))} KB`);

export function LibraryTab() {
  const [files, setFiles] = useState(null);
  const [cat, setCat] = useState('all');
  const [uploadCat, setUploadCat] = useState('presentation');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  const load = useCallback(() => { api('/api/sales-library').then(setFiles).catch(e => { showToast(e.message, 'error'); setFiles([]); }); }, []);
  useEffect(load, [load]);

  async function upload() {
    const file = fileRef.current?.files?.[0];
    if (!file) return showToast('Choose a file first', 'error');
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file); fd.append('category', uploadCat); fd.append('title', title.trim() || file.name);
      const res = await fetch('/api/sales-library', { method: 'POST', body: fd });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || 'Upload failed');
      setTitle(''); fileRef.current.value = ''; load(); showToast('Added to the library');
    } catch (e) { showToast(e.message, 'error'); } finally { setBusy(false); }
  }
  async function remove(f) {
    if (!confirm(`Delete "${f.title}"?`)) return;
    try { await api(`/api/sales-library/${f.id}`, { method: 'DELETE' }); load(); } catch (e) { showToast(e.message, 'error'); }
  }

  const list = (files || []).filter(f => cat === 'all' || f.category === cat);
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader><CardTitle>Add a file</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <Input className="h-9 w-56" placeholder="Title (optional)" value={title} onChange={e => setTitle(e.target.value)} />
          <Select value={uploadCat} onValueChange={setUploadCat}>
            <SelectTrigger className="h-9 w-40"><SelectValue /></SelectTrigger>
            <SelectContent>{CATEGORIES.map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent>
          </Select>
          <Input ref={fileRef} type="file" className="h-9 w-64" />
          <Button onClick={upload} disabled={busy}><UploadIcon data-icon="inline-start" />{busy ? 'Uploading…' : 'Upload'}</Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Library</CardTitle>
          <CardAction className="flex gap-1">
            {[['all', 'All'], ...CATEGORIES].map(([k, l]) => <Button key={k} size="sm" variant={cat === k ? 'default' : 'outline'} onClick={() => setCat(k)}>{l}</Button>)}
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col divide-y">
          {files === null && <p className="py-2 text-sm text-muted-foreground">Loading…</p>}
          {files && list.length === 0 && <p className="py-2 text-sm text-muted-foreground">Nothing here yet. Upload mailers, presentations and price lists so the whole team can find them.</p>}
          {list.map(f => (
            <div key={f.id} className="flex items-center gap-3 py-2 text-sm">
              <Badge variant="secondary" className="shrink-0">{catLabel(f.category)}</Badge>
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{f.title}</div>
                <div className="truncate text-xs text-muted-foreground">{f.file_name} · {sizeLabel(f.file_size)} · {f.uploaded_by || '—'} · {formatDate(f.uploaded_at)}</div>
              </div>
              <Button asChild size="icon" variant="outline" className="size-8"><a href={`/api/sales-library/${f.id}`} download><DownloadIcon /></a></Button>
              {<Button size="icon" variant="outline" className="size-8" onClick={() => remove(f)}><Trash2Icon /></Button>}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
