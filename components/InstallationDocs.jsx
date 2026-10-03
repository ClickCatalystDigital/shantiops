'use client';

// Installation → Documentation. Pick a project + call type → fill the Commissioning report or the
// Field Service report (Breakdown / ASC / Other). Field layout comes from
// lib/installation-report-template.mjs (shared with the PDF). Tables on desktop, cards on phones.
import { useEffect, useState, useCallback } from 'react';
import { PlusIcon, PencilIcon, TrashIcon, DownloadIcon, XIcon } from 'lucide-react';
import { api, showToast } from '@/lib/client';
import { formatDate } from '@/lib/format';
import { todayISO } from '@/lib/date';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from '@/components/ui/sheet';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import SearchableSelect from '@/components/SearchableSelect';
import { CustomerViewButton } from '@/components/InstallationVisits';
import SignaturePad from '@/components/SignaturePad';
import { projectOptions } from '@/components/InstallationVisits';
import AutoTextarea from '@/components/AutoTextarea';
import { CALL_TYPES, sectionsFor, emptyData, docLabel, computedValue } from '@/lib/installation-report-template.mjs';

function FieldInput({ field, value, onChange, all }) {
  const common = { value: value ?? '', onChange: e => onChange(e.target.value) };
  if (field.type === 'computed') return <div className="flex h-8 items-center rounded-lg border border-dashed bg-muted/40 px-2.5 text-sm tabular-nums">{computedValue(field.key, all) || <span className="text-muted-foreground">From the dates above</span>}</div>;
  if (field.type === 'textarea') return <AutoTextarea className="min-h-16" rows={2} {...common} />;
  if (field.type === 'text') return <AutoTextarea {...common} />;
  if (field.type === 'signature') return <SignaturePad value={value} onChange={onChange} />;
  if (field.type === 'select') {
    return (
      <Select value={value || ''} onValueChange={onChange}>
        <SelectTrigger className="w-full"><SelectValue placeholder="Select…" /></SelectTrigger>
        <SelectContent>{field.options.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
      </Select>
    );
  }
  return <Input type={field.type === 'number' ? 'text' : field.type} inputMode={field.type === 'number' ? 'decimal' : undefined} {...common} />;
}

// OK / NG as two tap-friendly toggles; tapping the active one clears it.
function StatusToggle({ value, onChange }) {
  return (
    <div className="flex gap-1">
      {[['ok', 'OK'], ['ng', 'NG']].map(([k, l]) => (
        <Button key={k} type="button" size="sm" className="h-8 min-w-11 px-2"
          variant={value === k ? (k === 'ok' ? 'default' : 'destructive') : 'outline'}
          onClick={() => onChange(value === k ? '' : k)}>{l}</Button>
      ))}
    </div>
  );
}

function Cell({ col, row, onChange }) {
  if (col.kind === 'status') return <StatusToggle value={row[col.key]} onChange={v => onChange(col.key, v)} />;
  if (col.kind === 'date') return <Input className="h-8 min-w-24" type="date" value={row[col.key] ?? ''} onChange={e => onChange(col.key, e.target.value)} />;
  return <AutoTextarea className="min-w-24" value={row[col.key] ?? ''} onChange={e => onChange(col.key, e.target.value)} />;
}

function RowsSection({ section, rows, onChange }) {
  const hasPreset = section.preset.length > 0;
  const fixed = section.columns.filter(c => c.fixed);
  const edit = section.columns.filter(c => !c.fixed);
  const setCell = (i, k, v) => onChange(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const remove = (i) => onChange(rows.filter((_, j) => j !== i));
  const rm = (i) => <Button type="button" size="icon" variant="ghost" className="size-8" onClick={() => remove(i)} aria-label="Remove row"><XIcon /></Button>;
  return (
    <div className="flex flex-col gap-2">
      <div className="hidden md:block">
        <Table>
          <TableHeader><TableRow>{section.columns.map(c => <TableHead key={c.key}>{c.label}</TableHead>)}<TableHead className="w-10" /></TableRow></TableHeader>
          <TableBody>{rows.map((r, i) => (
            <TableRow key={i}>
              {section.columns.map(c => (
                <TableCell key={c.key} className={c.fixed ? 'whitespace-normal text-sm' : ''}>
                  {c.fixed ? (r[c.key] || '') : <Cell col={c} row={r} onChange={(k, v) => setCell(i, k, v)} />}
                </TableCell>
              ))}
              <TableCell>{rm(i)}</TableCell>
            </TableRow>
          ))}</TableBody>
        </Table>
      </div>
      <div className="grid gap-2 md:hidden">
        {rows.map((r, i) => (
          <div key={i} className="rounded-xl border p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="text-sm font-medium">
                {fixed.length ? fixed.map(c => r[c.key]).filter(Boolean).join(' · ') : `Row ${i + 1}`}
              </div>
              {rm(i)}
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {edit.map(c => (
                <div key={c.key} className={c.kind === 'status' ? 'col-span-2' : c.kind === 'date' ? 'grid gap-1' : 'col-span-2 grid gap-1'}>
                  <Label className="text-xs text-muted-foreground">{c.label}</Label>
                  <Cell col={c} row={r} onChange={(k, v) => setCell(i, k, v)} />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" onClick={() => onChange([...rows, {}])}><PlusIcon data-icon="inline-start" />Add row</Button>
        {hasPreset && <Button type="button" size="sm" variant="ghost" onClick={() => window.confirm('Reset this table to the default rows? Values you entered here will be cleared.') && onChange(section.preset.map(r => ({ ...r })))}>Reset to default rows</Button>}
      </div>
    </div>
  );
}

function ReportSheet({ init, onClose, onSaved }) {
  const [data, setData] = useState(init.data);
  const [date, setDate] = useState(init.report_date || todayISO());
  const [saving, setSaving] = useState(false);
  const [fin, setFin] = useState(!!init.finalized_at);
  const [shared, setShared] = useState(!!init.customer_visible);
  const [history, setHistory] = useState([]);
  const sections = sectionsFor(init.call_type);
  useEffect(() => {
    api(`/api/installation-reports/history?project_id=${init.project_id}${init.id ? `&exclude=${init.id}` : ''}`).then(setHistory).catch(() => {});
  }, [init.project_id, init.id]);
  const setField = (k, v) => setData(d => ({ ...d, fields: { ...d.fields, [k]: v } }));
  const setRows = (k, rows) => setData(d => ({ ...d, tables: { ...d.tables, [k]: rows } }));

  async function save() {
    setSaving(true);
    try {
      if (init.id) await api(`/api/installation-reports/${init.id}`, { method: 'PATCH', body: { data, report_date: date } });
      else await api('/api/installation-reports', { method: 'POST', body: { project_id: init.project_id, call_type: init.call_type, report_date: date, data } });
      showToast('Report saved');
      onSaved();
    } catch (err) { showToast(err.message, 'error'); setSaving(false); }
  }

  // Finalize saves the current values first, then locks; reopen unlocks (and withdraws it from the customer).
  async function act(action, message) {
    setSaving(true);
    try {
      if (action === 'finalize') await api(`/api/installation-reports/${init.id}`, { method: 'PATCH', body: { data, report_date: date } });
      await api(`/api/installation-reports/${init.id}`, { method: 'PATCH', body: { action } });
      if (action === 'finalize') { setFin(true); }
      if (action === 'reopen') { setFin(false); setShared(false); }
      if (action === 'share') setShared(true);
      if (action === 'unshare') setShared(false);
      showToast(message);
      onSaved(false);
    } catch (err) { showToast(err.message, 'error'); }
    setSaving(false);
  }
  const canShare = fin;

  return (
    <Sheet open onOpenChange={o => !o && onClose()}>
      <SheetContent className="w-full data-[side=right]:sm:max-w-5xl">
        <SheetHeader>
          <SheetTitle>{init.call_type === 'Commissioning' ? 'Commissioning report' : `Field service report — ${init.call_type}`}</SheetTitle>
          <p className="text-xs text-muted-foreground">{init.project_label}{docLabel(init) ? ` · ${docLabel(init)}` : init.report_no ? ` · ${init.report_no}` : ''}</p>
        </SheetHeader>
        <fieldset disabled={fin} className={`min-w-0 flex flex-1 flex-col gap-6 overflow-y-auto px-4 pb-4 ${fin ? '[&_canvas]:pointer-events-none' : ''}`}>
          {fin && <div className="rounded-lg border bg-muted/40 px-3 py-2 text-sm">Finalized — read-only. Reopen to make changes.</div>}
          <div className="grid max-w-56 gap-1.5"><Label>Report date</Label><Input type="date" value={date} onChange={e => setDate(e.target.value)} /></div>
          {history.length > 0 && (
            <details className="rounded-lg border bg-muted/30 p-3 text-sm">
              <summary className="cursor-pointer font-medium">Previous customer remarks ({history.length})</summary>
              <div className="mt-2 flex flex-col gap-2">
                {history.map(h => (
                  <div key={h.id} className="rounded-md bg-background p-2">
                    <div className="text-xs text-muted-foreground">{h.report_no} · {h.call_type} · {new Date(String(h.at).replace(' ', 'T') + 'Z').toLocaleString('en-IN')}</div>
                    <div className="whitespace-pre-wrap">{h.remark}</div>
                  </div>
                ))}
              </div>
            </details>
          )}
          {sections.map(sec => (
            <section key={sec.key} className="flex flex-col gap-3">
              <h3 className="border-b pb-1 text-sm font-semibold">{sec.title}</h3>
              {sec.kind === 'fields' ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  {sec.fields.map(fl => (
                    <div key={fl.key} className={`grid gap-1.5 ${fl.type === 'textarea' || fl.type === 'signature' ? 'sm:col-span-2' : ''}`}>
                      <Label className="text-xs text-muted-foreground">{fl.label}</Label>
                      <FieldInput field={fl} value={data.fields[fl.key]} all={data.fields} onChange={v => setField(fl.key, v)} />
                    </div>
                  ))}
                </div>
              ) : <RowsSection section={sec} rows={data.tables[sec.key] || []} onChange={rows => setRows(sec.key, rows)} />}
            </section>
          ))}
        </fieldset>
        <SheetFooter className="flex-row flex-wrap items-center justify-end gap-2">
          {canShare && (
            <label className="mr-auto flex cursor-pointer items-center gap-2 text-sm">
              <button type="button" role="switch" aria-checked={shared} disabled={saving} onClick={() => act(shared ? 'unshare' : 'share', shared ? 'Hidden from customer' : 'Shared with customer')}
                className={`relative h-5 w-9 rounded-full transition-colors ${shared ? 'bg-primary' : 'bg-muted-foreground/30'}`}>
                <span className={`absolute left-0.5 top-0.5 size-4 rounded-full bg-white transition-transform ${shared ? 'translate-x-4' : ''}`} />
              </button>
              Show to customer{init.project_visible ? ' (on for the whole project)' : ''}
            </label>
          )}
          <Button variant="outline" onClick={onClose}>Close</Button>
          {init.id && (fin
            ? <Button variant="outline" disabled={saving} onClick={() => act('reopen', 'Report reopened')}>Reopen</Button>
            : <Button variant="outline" disabled={saving} onClick={() => window.confirm('Finalize this report? It becomes read-only until reopened.') && act('finalize', 'Report finalized')}>Finalize</Button>)}
          {!fin && <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save report'}</Button>}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

export default function InstallationDocs({ projects }) {
  const [projectId, setProjectId] = useState('');
  const [callType, setCallType] = useState('');
  const [reports, setReports] = useState(null);
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [projectVisible, setProjectVisible] = useState(false);
  const label = (id) => projectOptions(projects).find(o => o.value === String(id))?.label || '';

  const load = useCallback(async () => {
    try { setReports(await api(`/api/installation-reports${projectId ? `?project_id=${projectId}` : ''}`)); } catch (err) { showToast(err.message, 'error'); }
  }, [projectId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    setProjectVisible(false);
    if (projectId) api(`/api/installation-reports/project-visibility?project_id=${projectId}`).then(r => setProjectVisible(r.visible)).catch(() => {});
  }, [projectId]);
  async function toggleProjectVisible() {
    const next = !projectVisible;
    try {
      await api('/api/installation-reports/project-visibility', { method: 'PATCH', body: { project_id: Number(projectId), visible: next } });
      setProjectVisible(next); showToast(next ? 'Customer can view all finalized reports of this project' : 'Project-wide sharing turned off'); load();
    } catch (err) { showToast(err.message, 'error'); }
  }

  async function startNew() {
    if (!projectId || !callType) return showToast('Pick a project and a call type', 'error');
    setBusy(true);
    try {
      const prefill = await api(`/api/installation/project-info?project_id=${projectId}`);
      setEditing({ project_id: Number(projectId), call_type: callType, project_label: label(projectId), data: emptyData(callType, prefill) });
    } catch (err) { showToast(err.message, 'error'); }
    setBusy(false);
  }
  async function open(r) {
    try {
      const full = await api(`/api/installation-reports/${r.id}`);
      // Merge onto the current template so a form change never hides saved values; an empty saved table gets its default rows back.
      const base = emptyData(full.call_type);
      const tables = { ...base.tables };
      for (const [k, rows] of Object.entries(full.data.tables || {})) if (rows.length) tables[k] = rows;
      setEditing({ id: r.id, report_no: r.report_no, doc_no: full.doc_no, revision: full.revision, project_visible: !!r.project_visible, project_id: r.project_id, call_type: full.call_type, finalized_at: full.finalized_at, customer_visible: full.customer_visible, report_date: full.report_date, project_label: label(r.project_id) || r.project_no,
        data: { fields: { ...base.fields, ...(full.data.fields || {}) }, tables } });
    } catch (err) {
      // A list can go stale (someone deleted the report) — reload it instead of leaving a dead row.
      showToast(/not found/i.test(err.message) ? 'That report no longer exists — list refreshed' : err.message, 'error');
      load();
    }
  }
  async function remove(r) {
    if (!window.confirm(`Delete ${r.report_no}?`)) return;
    try { await api(`/api/installation-reports/${r.id}`, { method: 'DELETE' }); load(); } catch (err) { showToast(err.message, 'error'); }
  }
  const acts = (r) => (
    <div className="flex justify-end gap-1">
      <Button size="icon" variant="ghost" onClick={() => open(r)} aria-label="Open"><PencilIcon /></Button>
      <Button size="icon" variant="ghost" asChild aria-label="PDF"><a href={`/api/installation-reports/${r.id}/pdf`} target="_blank" rel="noreferrer"><DownloadIcon /></a></Button>
      <Button size="icon" variant="ghost" onClick={() => remove(r)} aria-label="Delete"><TrashIcon /></Button>
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      {/* Pickers sit outside the Card: Card is overflow-hidden and would clip the project dropdown. */}
      <div className="flex flex-col gap-2 md:flex-row">
        <div className="md:w-[32rem]"><SearchableSelect value={projectId} onChange={setProjectId} placeholder="Search a project…" options={projectOptions(projects)} /></div>
        <Select value={callType} onValueChange={setCallType}>
          <SelectTrigger className="md:w-48"><SelectValue placeholder="Call type" /></SelectTrigger>
          <SelectContent>{CALL_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
        </Select>
        <Button onClick={startNew} disabled={busy}><PlusIcon data-icon="inline-start" />New report</Button>
      </div>
    <Card>
      <CardHeader>
        <CardTitle>Documentation</CardTitle>
        {projectId && (
          <CardAction className="flex flex-wrap items-center gap-3">
            <CustomerViewButton projects={projects} projectId={projectId} />
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <button type="button" role="switch" aria-checked={projectVisible} onClick={toggleProjectVisible}
                className={`relative h-5 w-9 rounded-full transition-colors ${projectVisible ? 'bg-primary' : 'bg-muted-foreground/30'}`}>
                <span className={`absolute left-0.5 top-0.5 size-4 rounded-full bg-white transition-transform ${projectVisible ? 'translate-x-4' : ''}`} />
              </button>
              Customer can view all finalized reports
            </label>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {reports === null ? <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
          : reports.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">No reports yet{projectId ? ' for this project' : ''}.</p> : (
          <>
            <div className="hidden md:block">
              <Table>
                <TableHeader><TableRow><TableHead>No.</TableHead><TableHead>Project</TableHead><TableHead>Call type</TableHead><TableHead>Date</TableHead><TableHead>By</TableHead><TableHead className="w-32" /></TableRow></TableHeader>
                <TableBody>{reports.map(r => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{docLabel(r) || r.report_no}{docLabel(r) && <div className="text-xs font-normal text-muted-foreground">{r.report_no}</div>}</TableCell>
                    <TableCell>{r.project_no}<div className="text-xs text-muted-foreground">{r.customer_name}</div></TableCell>
                    <TableCell><Badge variant="outline">{r.call_type}</Badge>{r.finalized_at && <Badge className="ml-1" variant="secondary">{r.customer_visible || r.project_visible ? 'Shared' : 'Final'}</Badge>}</TableCell>
                    <TableCell>{r.report_date ? formatDate(r.report_date) : '—'}</TableCell>
                    <TableCell>{r.created_by}</TableCell>
                    <TableCell>{acts(r)}</TableCell>
                  </TableRow>
                ))}</TableBody>
              </Table>
            </div>
            <div className="grid gap-2 md:hidden">
              {reports.map(r => (
                <div key={r.id} className="rounded-xl border p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="font-medium">{docLabel(r) || r.report_no}</div><div><Badge variant="outline">{r.call_type}</Badge>{r.finalized_at && <Badge className="ml-1" variant="secondary">{r.customer_visible || r.project_visible ? 'Shared' : 'Final'}</Badge>}</div>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">{r.project_no} · {r.customer_name} · {r.report_date ? formatDate(r.report_date) : '—'}</div>
                  <div className="mt-1">{acts(r)}</div>
                </div>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
      {editing && <ReportSheet init={editing} onClose={() => setEditing(null)} onSaved={(close = true) => { if (close) setEditing(null); load(); }} />}
    </div>
  );
}
