'use client';

// Installation → Documentation. Pick a project (or a service-only customer) + call type → fill the
// Commissioning report or the Field Service report (Breakdown / ASC / Other). Field layout comes from
// lib/installation-report-template.mjs (shared with the PDF). Tables on desktop, cards on phones.
import { useEffect, useState, useCallback, useMemo } from 'react';
import { PlusIcon, PencilIcon, TrashIcon, DownloadIcon, XIcon, UserPlusIcon, FileTextIcon, LockIcon, FolderKanbanIcon, UsersIcon, RotateCcwIcon } from 'lucide-react';
import { api, showToast } from '@/lib/client';
import { formatDate } from '@/lib/format';
import { todayISO } from '@/lib/date';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from '@/components/ui/sheet';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import SearchableSelect from '@/components/SearchableSelect';
import { CustomerViewButton, projectOptions } from '@/components/InstallationVisits';
import SignaturePad from '@/components/SignaturePad';
import AutoTextarea from '@/components/AutoTextarea';
import { CALL_TYPES, sectionsFor, emptyData, docLabel, computedValue, cleanPhone } from '@/lib/installation-report-template.mjs';

function FieldInput({ field, value, onChange, all }) {
  const common = { value: value ?? '', onChange: e => onChange(e.target.value) };
  if (field.type === 'computed') return <div className="flex h-8 items-center rounded-md border border-dashed bg-muted/40 px-2.5 text-sm tabular-nums">{computedValue(field.key, all) || <span className="text-muted-foreground">From the dates above</span>}</div>;
  if (field.type === 'textarea') return <AutoTextarea className="min-h-16" rows={2} {...common} />;
  if (field.type === 'text') return <AutoTextarea {...common} />;
  if (field.type === 'signature') return <SignaturePad value={value} onChange={onChange} />;
  if (field.type === 'phone') return <Input type="tel" inputMode="tel" autoComplete="tel" placeholder="e.g. 98480 12345" value={value ?? ''} onChange={e => onChange(cleanPhone(e.target.value))} />;
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
    <div className="inline-flex rounded-md border p-0.5">
      {[['ok', 'OK'], ['ng', 'NG']].map(([k, l]) => (
        <button key={k} type="button" onClick={() => onChange(value === k ? '' : k)}
          className={`h-7 min-w-10 rounded-[5px] px-2 text-xs font-medium transition-colors ${value === k ? (k === 'ok' ? 'bg-emerald-600 text-white' : 'bg-destructive text-white') : 'text-muted-foreground hover:bg-muted'}`}>{l}</button>
      ))}
    </div>
  );
}

function Cell({ col, row, onChange }) {
  if (col.kind === 'status') return <StatusToggle value={row[col.key]} onChange={v => onChange(col.key, v)} />;
  if (col.kind === 'date') return <Input className="h-8 min-w-28" type="date" value={row[col.key] ?? ''} onChange={e => onChange(col.key, e.target.value)} />;
  return <AutoTextarea className="min-w-24" value={row[col.key] ?? ''} onChange={e => onChange(col.key, e.target.value)} />;
}

// A row the user added (not one of the printed preset rows) can edit every column, including the
// "fixed" check point / spec / unit ones.
const isCustom = (r) => !!r._custom;

function RowsSection({ section, rows, onChange }) {
  const hasPreset = section.preset.length > 0;
  const fixed = section.columns.filter(c => c.fixed);
  const setCell = (i, k, v) => onChange(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const remove = (i) => onChange(rows.filter((_, j) => j !== i));
  const rm = (i) => <Button type="button" size="icon" variant="ghost" className="size-7 text-muted-foreground hover:text-destructive" onClick={() => remove(i)} aria-label="Remove row"><XIcon /></Button>;
  return (
    <div className="flex flex-col gap-3">
      <div className="hidden overflow-hidden rounded-lg border md:block">
        <Table>
          <TableHeader className="bg-muted/50"><TableRow>{section.columns.map(c => <TableHead key={c.key} className="h-9 text-xs font-medium">{c.label}</TableHead>)}<TableHead className="w-10" /></TableRow></TableHeader>
          <TableBody>{rows.map((r, i) => (
            <TableRow key={i} className="hover:bg-transparent">
              {section.columns.map(c => (
                <TableCell key={c.key} className={`align-top py-1.5 ${c.fixed && !isCustom(r) ? 'whitespace-normal pt-3 text-sm text-muted-foreground' : ''}`}>
                  {c.fixed && !isCustom(r) ? (r[c.key] || '') : <Cell col={c} row={r} onChange={(k, v) => setCell(i, k, v)} />}
                </TableCell>
              ))}
              <TableCell className="align-top py-1.5">{rm(i)}</TableCell>
            </TableRow>
          ))}</TableBody>
        </Table>
      </div>
      <div className="grid gap-2 md:hidden">
        {rows.map((r, i) => {
          const editCols = isCustom(r) ? section.columns : section.columns.filter(c => !c.fixed);
          return (
            <div key={i} className="rounded-lg border bg-background p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="text-sm font-medium">
                  {!isCustom(r) && fixed.length ? fixed.map(c => r[c.key]).filter(Boolean).join(' · ') : `Row ${i + 1}`}
                </div>
                {rm(i)}
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {editCols.map(c => (
                  <div key={c.key} className={c.kind === 'date' ? 'grid gap-1' : 'col-span-2 grid gap-1'}>
                    <Label className="text-xs text-muted-foreground">{c.label}</Label>
                    <Cell col={c} row={r} onChange={(k, v) => setCell(i, k, v)} />
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" onClick={() => onChange([...rows, { _custom: true }])}><PlusIcon data-icon="inline-start" />Add row</Button>
        {hasPreset && <Button type="button" size="sm" variant="ghost" className="text-muted-foreground" onClick={() => window.confirm('Reset this table to the default rows? Values you entered here will be cleared.') && onChange(section.preset.map(r => ({ ...r })))}><RotateCcwIcon data-icon="inline-start" />Reset to default rows</Button>}
      </div>
    </div>
  );
}

const wide = (fl) => fl.type === 'textarea' || fl.type === 'signature';

function ReportSheet({ init, onClose, onSaved }) {
  const [data, setData] = useState(init.data);
  const [date, setDate] = useState(init.report_date || todayISO());
  const [saving, setSaving] = useState(false);
  const [fin, setFin] = useState(!!init.finalized_at);
  const [shared, setShared] = useState(!!init.customer_visible);
  const [history, setHistory] = useState([]);
  const sections = sectionsFor(init.call_type);
  const owner = init.project_id ? `project_id=${init.project_id}` : `service_customer_id=${init.service_customer_id}`;
  useEffect(() => {
    api(`/api/installation-reports/history?${owner}${init.id ? `&exclude=${init.id}` : ''}`).then(setHistory).catch(() => {});
  }, [owner, init.id]);
  const setField = (k, v) => setData(d => ({ ...d, fields: { ...d.fields, [k]: v } }));
  const setRows = (k, rows) => setData(d => ({ ...d, tables: { ...d.tables, [k]: rows } }));

  async function save() {
    setSaving(true);
    try {
      if (init.id) await api(`/api/installation-reports/${init.id}`, { method: 'PATCH', body: { data, report_date: date } });
      else await api('/api/installation-reports', { method: 'POST', body: { project_id: init.project_id, service_customer_id: init.service_customer_id, call_type: init.call_type, report_date: date, data } });
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
  const canShare = fin && !!init.project_id; // a service-only customer has no portal

  return (
    <Sheet open onOpenChange={o => !o && onClose()}>
      <SheetContent className="w-full gap-0 data-[side=right]:sm:max-w-5xl">
        <SheetHeader className="border-b">
          <div className="flex flex-wrap items-center gap-2 pr-8">
            <SheetTitle className="text-base">{init.call_type === 'Commissioning' ? 'Commissioning report' : 'Field service report'}</SheetTitle>
            {init.call_type !== 'Commissioning' && <Badge variant="outline">{init.call_type}</Badge>}
            {fin ? <Badge variant="secondary"><LockIcon data-icon="inline-start" />Finalized</Badge> : <Badge variant="outline" className="text-muted-foreground">Draft</Badge>}
          </div>
          <SheetDescription>{init.owner_label}{docLabel(init) ? ` · ${docLabel(init)}` : init.report_no ? ` · ${init.report_no}` : ''}</SheetDescription>
        </SheetHeader>
        <fieldset disabled={fin} className={`min-w-0 flex flex-1 flex-col gap-5 overflow-y-auto bg-muted/30 p-4 ${fin ? '[&_canvas]:pointer-events-none' : ''}`}>
          {fin && <div className="flex items-center gap-2 rounded-lg border bg-background px-3 py-2 text-sm text-muted-foreground"><LockIcon className="size-4" />Finalized — read-only. Reopen to make changes.</div>}
          <div className="flex flex-wrap items-end gap-4">
            <div className="grid w-48 gap-1.5"><Label className="text-xs font-medium text-muted-foreground">Report date</Label><Input type="date" className="bg-background" value={date} onChange={e => setDate(e.target.value)} /></div>
          </div>
          {history.length > 0 && (
            <details className="rounded-xl border bg-background p-4 text-sm">
              <summary className="cursor-pointer font-medium">Previous customer remarks <span className="text-muted-foreground">({history.length})</span></summary>
              <div className="mt-3 flex flex-col gap-2">
                {history.map(h => (
                  <div key={h.id} className="rounded-lg bg-muted/50 p-2.5">
                    <div className="text-xs text-muted-foreground">{h.report_no} · {h.call_type} · {new Date(String(h.at).replace(' ', 'T') + 'Z').toLocaleString('en-IN')}</div>
                    <div className="mt-1 whitespace-pre-wrap">{h.remark}</div>
                  </div>
                ))}
              </div>
            </details>
          )}
          {sections.map(sec => (
            <section key={sec.key} className="rounded-xl border bg-background shadow-xs">
              <h3 className="border-b px-4 py-3 text-sm font-semibold tracking-tight">{sec.title}</h3>
              <div className="p-4">
                {sec.kind === 'fields' ? (
                  <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
                    {sec.fields.map(fl => (
                      <div key={fl.key} className={`grid content-start gap-1.5 ${wide(fl) ? 'sm:col-span-2' : ''}`}>
                        <Label className="text-xs font-medium text-muted-foreground">{fl.label}</Label>
                        <FieldInput field={fl} value={data.fields[fl.key]} all={data.fields} onChange={v => setField(fl.key, v)} />
                      </div>
                    ))}
                  </div>
                ) : <RowsSection section={sec} rows={data.tables[sec.key] || []} onChange={rows => setRows(sec.key, rows)} />}
              </div>
            </section>
          ))}
        </fieldset>
        <SheetFooter className="flex-row flex-wrap items-center justify-end gap-2 border-t bg-background">
          {canShare && (
            <label className="mr-auto flex cursor-pointer items-center gap-2 text-sm">
              <Switch on={shared} disabled={saving} onClick={() => act(shared ? 'unshare' : 'share', shared ? 'Hidden from customer' : 'Shared with customer')} />
              Show to customer{init.project_visible ? ' (on for the whole project)' : ''}
            </label>
          )}
          <Button variant="ghost" onClick={onClose}>Close</Button>
          {init.id && (fin
            ? <Button variant="outline" disabled={saving} onClick={() => act('reopen', 'Report reopened')}>Reopen</Button>
            : <Button variant="outline" disabled={saving} onClick={() => window.confirm('Finalize this report? It becomes read-only until reopened.') && act('finalize', 'Report finalized')}>Finalize</Button>)}
          {!fin && <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save report'}</Button>}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function Switch({ on, ...props }) {
  return (
    <button type="button" role="switch" aria-checked={on} {...props}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${on ? 'bg-primary' : 'bg-muted-foreground/30'}`}>
      <span className={`absolute left-0.5 top-0.5 size-4 rounded-full bg-white shadow-sm transition-transform ${on ? 'translate-x-4' : ''}`} />
    </button>
  );
}

// New service-only customer (no project). Saved to the shared service customer list, so it is also
// offered on the Service expense forms.
function NewCustomerDialog({ open, onOpenChange, onCreated }) {
  const blank = { name: '', contact_person: '', phone: '', email: '', address: '' };
  const [f, setF] = useState(blank);
  const [saving, setSaving] = useState(false);
  const set = (k) => e => setF(x => ({ ...x, [k]: k === 'phone' ? cleanPhone(e.target.value) : e.target.value }));
  useEffect(() => { if (open) setF(blank); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  async function save(e) {
    e.preventDefault();
    if (!f.name.trim()) return showToast('Customer name is required', 'error');
    setSaving(true);
    try { onCreated(await api('/api/service-customers', { method: 'POST', body: f })); showToast('Customer added'); }
    catch (err) { showToast(err.message, 'error'); }
    setSaving(false);
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={save} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>New customer</DialogTitle>
            <DialogDescription>For service work on a boiler that isn&apos;t one of our projects. These details pre-fill the report.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5"><Label htmlFor="nc-name">Customer / company name</Label><Input id="nc-name" autoFocus value={f.name} onChange={set('name')} placeholder="e.g. Sri Lakshmi Rice Mill" /></div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5"><Label htmlFor="nc-person">Contact person</Label><Input id="nc-person" value={f.contact_person} onChange={set('contact_person')} /></div>
            <div className="grid gap-1.5"><Label htmlFor="nc-phone">Phone</Label><Input id="nc-phone" type="tel" inputMode="tel" value={f.phone} onChange={set('phone')} /></div>
          </div>
          <div className="grid gap-1.5"><Label htmlFor="nc-email">E-mail</Label><Input id="nc-email" type="email" value={f.email} onChange={set('email')} /></div>
          <div className="grid gap-1.5"><Label htmlFor="nc-address">Site address</Label><Textarea id="nc-address" rows={3} value={f.address} onChange={set('address')} /></div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Add customer'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// A service customer's details mapped onto both report forms' field keys.
const customerPrefill = (c) => ({
  customer_name: c.name, site_address: c.address || '', contact_person: c.contact_person || '', contact_no: c.phone || '',
  client: c.name, address: c.address || '', phone: c.phone || '', email: c.email || '', person_contacted: c.contact_person || '',
});

function ShareToggle({ on, onClick }) {
  return <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground"><Switch on={on} onClick={onClick} />Customer can view all finalized reports</label>;
}

export default function InstallationDocs({ projects }) {
  const [mode, setMode] = useState('project'); // project | customer
  const [projectId, setProjectId] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [customers, setCustomers] = useState([]);
  const [newCustomer, setNewCustomer] = useState(false);
  const [callType, setCallType] = useState('');
  const [reports, setReports] = useState(null);
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [projectVisible, setProjectVisible] = useState(false);
  const pOptions = useMemo(() => projectOptions(projects), [projects]);
  const cOptions = useMemo(() => customers.map(c => ({ value: String(c.id), label: c.phone ? `${c.name} · ${c.phone}` : c.name })), [customers]);
  const pLabel = (id) => pOptions.find(o => o.value === String(id))?.label || '';

  useEffect(() => { api('/api/service-customers?others=1').then(setCustomers).catch(() => {}); }, []);

  const filter = mode === 'project' ? (projectId ? `?project_id=${projectId}` : '') : (customerId ? `?service_customer_id=${customerId}` : '');
  const load = useCallback(async () => {
    try { setReports(await api(`/api/installation-reports${filter}`)); } catch (err) { showToast(err.message, 'error'); }
  }, [filter]);
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
    const target = mode === 'project' ? projectId : customerId;
    if (!target) return showToast(mode === 'project' ? 'Pick a project' : 'Pick or add a customer', 'error');
    if (!callType) return showToast('Pick a call type', 'error');
    setBusy(true);
    try {
      if (mode === 'project') {
        const prefill = await api(`/api/installation/project-info?project_id=${projectId}`);
        setEditing({ project_id: Number(projectId), call_type: callType, owner_label: pLabel(projectId), data: emptyData(callType, prefill) });
      } else {
        const c = customers.find(x => String(x.id) === String(customerId));
        setEditing({ service_customer_id: Number(customerId), call_type: callType, owner_label: c?.name || '', data: emptyData(callType, c ? customerPrefill(c) : {}) });
      }
    } catch (err) { showToast(err.message, 'error'); }
    setBusy(false);
  }
  async function open(r) {
    try {
      const full = await api(`/api/installation-reports/${r.id}`);
      // Merge onto the current template so a form change never hides saved values; an empty saved table gets its default rows back.
      const base = emptyData(full.call_type);
      const tables = { ...base.tables };
      const fixedKeys = Object.fromEntries(sectionsFor(full.call_type).filter(s => s.kind === 'rows').map(s => [s.key, s.columns.filter(c => c.fixed).map(c => c.key)]));
      for (const [k, rows] of Object.entries(full.data.tables || {})) {
        // Rows added before the _custom flag existed have their fixed columns blank — let them be edited too.
        if (rows.length) tables[k] = rows.map(row => (!row._custom && (fixedKeys[k] || []).length && (fixedKeys[k] || []).every(c => !row[c]) ? { ...row, _custom: true } : row));
      }
      setEditing({ id: r.id, report_no: r.report_no, doc_no: full.doc_no, revision: full.revision, project_visible: !!r.project_visible, project_id: r.project_id, service_customer_id: r.service_customer_id,
        call_type: full.call_type, finalized_at: full.finalized_at, customer_visible: full.customer_visible, report_date: full.report_date,
        owner_label: r.project_id ? (pLabel(r.project_id) || r.project_no) : r.customer_name,
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
    <div className="flex justify-end gap-0.5">
      <Button size="icon" variant="ghost" className="size-8" onClick={() => open(r)} aria-label="Open"><PencilIcon /></Button>
      <Button size="icon" variant="ghost" className="size-8" asChild aria-label="PDF"><a href={`/api/installation-reports/${r.id}/pdf`} target="_blank" rel="noreferrer"><DownloadIcon /></a></Button>
      <Button size="icon" variant="ghost" className="size-8 text-muted-foreground hover:text-destructive" onClick={() => remove(r)} aria-label="Delete"><TrashIcon /></Button>
    </div>
  );
  const owner = (r) => r.project_id ? r.project_no : <span className="inline-flex items-center gap-1"><UsersIcon className="size-3.5 text-muted-foreground" />Service customer</span>;
  const status = (r) => r.finalized_at
    ? <Badge variant="secondary">{r.customer_visible || r.project_visible ? 'Shared' : 'Final'}</Badge>
    : <Badge variant="outline" className="text-muted-foreground">Draft</Badge>;

  return (
    <div className="flex flex-col gap-4">
      {/* Picker card is overflow-visible: the search dropdowns would be clipped by Card's overflow-hidden. */}
      <Card className="overflow-visible">
        <CardHeader>
          <CardTitle>New report</CardTitle>
          <CardDescription>Choose who the report is for and the type of visit.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Tabs value={mode} onValueChange={setMode}>
            <TabsList>
              <TabsTrigger value="project"><FolderKanbanIcon />Our project</TabsTrigger>
              <TabsTrigger value="customer"><UsersIcon />Other customer</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
            <div className="grid min-w-0 flex-1 gap-1.5">
              <Label className="text-xs font-medium text-muted-foreground">{mode === 'project' ? 'Project' : 'Customer'}</Label>
              {mode === 'project'
                ? <SearchableSelect value={projectId} onChange={setProjectId} placeholder="Search a project…" options={pOptions} />
                : (
                  <div className="flex gap-2">
                    <div className="min-w-0 flex-1"><SearchableSelect value={customerId} onChange={setCustomerId} placeholder={customers.length ? 'Search a customer…' : 'No customers yet — add one'} options={cOptions} /></div>
                    <Button type="button" variant="outline" onClick={() => setNewCustomer(true)}><UserPlusIcon data-icon="inline-start" />New customer</Button>
                  </div>
                )}
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Call type</Label>
              <div className="inline-flex flex-wrap gap-1 rounded-lg bg-muted p-[3px]">
                {CALL_TYPES.map(t => (
                  <button key={t} type="button" onClick={() => setCallType(t)}
                    className={`h-7 rounded-md px-3 text-sm font-medium transition-colors ${callType === t ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>{t}</button>
                ))}
              </div>
            </div>
            <Button onClick={startNew} disabled={busy}><PlusIcon data-icon="inline-start" />{busy ? 'Opening…' : 'Start report'}</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Reports</CardTitle>
          <CardDescription>{mode === 'project' ? (projectId ? pLabel(projectId) : 'All projects and customers') : (customerId ? customers.find(c => String(c.id) === customerId)?.name : 'All projects and customers')}</CardDescription>
          {mode === 'project' && projectId && (
            <CardAction className="flex flex-wrap items-center gap-3">
              <CustomerViewButton projects={projects} projectId={projectId} />
              <ShareToggle on={projectVisible} onClick={toggleProjectVisible} />
            </CardAction>
          )}
        </CardHeader>
        <CardContent>
          {reports === null ? <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>
            : reports.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-10 text-center">
                <FileTextIcon className="size-8 text-muted-foreground/50" />
                <p className="text-sm text-muted-foreground">No reports yet{projectId || customerId ? ' here' : ''}.</p>
              </div>
            ) : (
            <>
              <div className="hidden overflow-hidden rounded-lg border md:block">
                <Table>
                  <TableHeader className="bg-muted/50"><TableRow><TableHead>Report</TableHead><TableHead>For</TableHead><TableHead>Type</TableHead><TableHead>Status</TableHead><TableHead>Date</TableHead><TableHead>By</TableHead><TableHead className="w-28" /></TableRow></TableHeader>
                  <TableBody>{reports.map(r => (
                    <TableRow key={r.id} className="cursor-pointer" onClick={e => !e.target.closest('a,button') && open(r)}>
                      <TableCell className="font-medium">{docLabel(r) || r.report_no}{docLabel(r) && <div className="text-xs font-normal text-muted-foreground">{r.report_no}</div>}</TableCell>
                      <TableCell>{owner(r)}<div className="text-xs text-muted-foreground">{r.customer_name}</div></TableCell>
                      <TableCell><Badge variant="outline">{r.call_type}</Badge></TableCell>
                      <TableCell>{status(r)}</TableCell>
                      <TableCell className="tabular-nums">{r.report_date ? formatDate(r.report_date) : '—'}</TableCell>
                      <TableCell className="text-muted-foreground">{r.created_by}</TableCell>
                      <TableCell>{acts(r)}</TableCell>
                    </TableRow>
                  ))}</TableBody>
                </Table>
              </div>
              <div className="grid gap-2 md:hidden">
                {reports.map(r => (
                  <div key={r.id} className="rounded-xl border p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="font-medium">{docLabel(r) || r.report_no}</div>
                      <div className="flex gap-1"><Badge variant="outline">{r.call_type}</Badge>{status(r)}</div>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">{r.project_no || 'Service customer'} · {r.customer_name} · {r.report_date ? formatDate(r.report_date) : '—'}</div>
                    <Separator className="my-2" />
                    {acts(r)}
                  </div>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>
      <NewCustomerDialog open={newCustomer} onOpenChange={setNewCustomer}
        onCreated={c => { setCustomers(list => [...list.filter(x => x.id !== c.id), c].sort((a, b) => a.name.localeCompare(b.name))); setCustomerId(String(c.id)); setNewCustomer(false); }} />
      {editing && <ReportSheet init={editing} onClose={() => setEditing(null)} onSaved={(close = true) => { if (close) setEditing(null); load(); }} />}
    </div>
  );
}
