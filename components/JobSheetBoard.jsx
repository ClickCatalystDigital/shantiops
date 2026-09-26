'use client';

// The Job Card board: one tile per boiler job, opening a wide sheet with the 33-stage table that
// mirrors the client's paper form (lib/job-sheet-stages.mjs). One primary action per stage row:
// Start -> Finish (Production) -> QC sign (QC, a record only — it never blocks the next stage).
// Signing stamps the logged-in user server-side. Used on Shop Floor (Production) and in QC.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { api, showToast } from '@/lib/client';
import { formatDate } from '@/lib/format';
import { todayISO } from '@/lib/date';
import { stageState } from '@/lib/job-sheet-stages.mjs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { PlusIcon, PrinterIcon, CheckIcon, PlayIcon, ShieldCheckIcon, Trash2Icon, RotateCcwIcon, ChevronDownIcon } from 'lucide-react';
import SearchableSelect from '@/components/SearchableSelect';
import CertPicker from '@/components/CertPicker';
import FloatingPdfPanel from '@/components/FloatingPdfPanel';
import PdfInlinePreview from '@/components/PdfInlinePreview';

const STATE_TONE = {
  pending: '', in_progress: 'bg-primary/5', done: 'bg-warning-surface/60', qc_signed: 'bg-success-surface/60',
};

export default function JobSheetBoard({ workers = [], projects = [], canProduction = false, canQc = false }) {
  const [sheets, setSheets] = useState(null);
  const [search, setSearch] = useState('');
  const [projectFilter, setProjectFilter] = useState('all');
  const [openId, setOpenId] = useState(null);
  const [creating, setCreating] = useState(false);
  const highlight = useSearchParams().get('highlight');

  const load = useCallback(async () => {
    try { setSheets(await api('/api/job-sheets')); } catch (err) { showToast(err.message, 'error'); setSheets([]); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (sheets && highlight) { const s = sheets.find(x => x.jc_no === highlight); if (s) setOpenId(s.id); }
  }, [sheets?.length, highlight]); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = useMemo(() => (sheets || []).filter(s => {
    if (projectFilter !== 'all' && String(s.project_id || '') !== projectFilter) return false;
    const q = search.trim().toLowerCase();
    return !q || [s.jc_no, s.job_number, s.project_no].some(v => v?.toLowerCase().includes(q));
  }), [sheets, search, projectFilter]);

  const projectOptions = [{ value: 'all', label: 'All projects' }, ...projects.map(p => ({ value: String(p.id), label: `${p.project_no} · ${p.customer_name || ''}` }))];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search job no. / project…" className="w-56" />
        <div className="w-64"><SearchableSelect value={projectFilter} onChange={setProjectFilter} options={projectOptions} placeholder="All projects" /></div>
        <div className="flex-1" />
        {canProduction && <Button onClick={() => setCreating(true)}><PlusIcon /> New Job Card</Button>}
      </div>

      {sheets === null ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>
      ) : shown.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">No job cards yet.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map(s => <SheetTile key={s.id} s={s} onOpen={() => setOpenId(s.id)} />)}
        </div>
      )}

      {creating && <NewSheetDialog projects={projects} onClose={() => setCreating(false)} onCreated={id => { setCreating(false); load(); setOpenId(id); }} />}
      {openId && <SheetDetail id={openId} workers={workers} canProduction={canProduction} canQc={canQc}
        onClose={() => { setOpenId(null); load(); }} onDeleted={() => { setOpenId(null); load(); }} />}
    </div>
  );
}

function SheetTile({ s, onOpen }) {
  const pct = s.total ? Math.round((s.done / s.total) * 100) : 0;
  return (
    <button type="button" onClick={onOpen}
      className={`flex flex-col gap-2 rounded-xl border p-4 text-left shadow-sm transition-colors hover:border-primary/50 ${s.waiting_on_qc ? 'border-warning/40 bg-warning-surface/40' : 'bg-card'}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold">{s.job_number || s.jc_no}</span>
        <span className="text-xs text-muted-foreground">{s.jc_no}</span>
      </div>
      <p className="truncate text-xs text-muted-foreground">{s.project_no || 'No project'}{s.project_name ? ` · ${s.project_name}` : ''}</p>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} /></div>
      <div className="flex items-center justify-between text-xs">
        <span className="tnum font-medium">{s.done} / {s.total} stages</span>
        {s.waiting_on_qc && <Badge variant="outline" className="border-warning/40 text-warning">Waiting on QC</Badge>}
      </div>
      <p className="truncate text-xs text-muted-foreground">
        {s.current_stage ? <>Now: <span className="font-medium text-foreground">{s.current_stage.name}</span>{s.current_stage.fitter_name ? ` · ${s.current_stage.fitter_name}` : ''}</> : 'All stages finished'}
      </p>
    </button>
  );
}

function NewSheetDialog({ projects, onClose, onCreated }) {
  const [f, setF] = useState({ job_number: '', project_id: '', drawing_approved_on: '' });
  const [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault(); setBusy(true);
    try {
      const r = await api('/api/job-sheets', { method: 'POST', body: f });
      showToast('Job card created with 33 stages'); onCreated(r.id);
    } catch (err) { showToast(err.message, 'error'); setBusy(false); }
  }
  return (
    <Dialog open onOpenChange={v => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>New Job Card</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1"><Label>Job number</Label>
            <Input value={f.job_number} onChange={e => setF({ ...f, job_number: e.target.value })} required autoFocus /></div>
          <div className="flex flex-col gap-1"><Label>Project</Label>
            <SearchableSelect value={f.project_id} onChange={v => setF({ ...f, project_id: v })} placeholder="Select project…"
              options={projects.map(p => ({ value: String(p.id), label: `${p.project_no} · ${p.customer_name || ''}` }))} /></div>
          <div className="flex flex-col gap-1"><Label>Drawing approved on</Label>
            <Input type="date" value={f.drawing_approved_on} onChange={e => setF({ ...f, drawing_approved_on: e.target.value })} /></div>
          <p className="text-xs text-muted-foreground">All 33 production stages are added automatically.</p>
          <DialogFooter><Button type="submit" disabled={busy}>Create</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SheetDetail({ id, workers, canProduction, canQc, onClose, onDeleted }) {
  const [d, setD] = useState(null);
  const [filter, setFilter] = useState('all');
  const [showHeader, setShowHeader] = useState(false);
  const [qcRow, setQcRow] = useState(null);
  const curRef = useRef(null);
  const [scanVer, setScanVer] = useState(0);

  const refresh = useCallback(async () => {
    try { setD(await api(`/api/job-sheets/${id}`)); } catch (err) { showToast(err.message, 'error'); }
  }, [id]);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => { if (d && curRef.current) curRef.current.scrollIntoView({ block: 'center' }); }, [d?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function stage(row, body) {
    try { await api(`/api/job-sheets/${id}/stages/${row.id}`, { method: 'PATCH', body }); await refresh(); }
    catch (err) { showToast(err.message, 'error'); }
  }
  async function patch(body) {
    try { await api(`/api/job-sheets/${id}`, { method: 'PATCH', body }); await refresh(); }
    catch (err) { showToast(err.message, 'error'); }
  }
  async function addStage() {
    const name = window.prompt('New stage name');
    if (!name) return;
    try { await api(`/api/job-sheets/${id}/stages`, { method: 'POST', body: { name } }); await refresh(); }
    catch (err) { showToast(err.message, 'error'); }
  }
  async function removeStage(row) {
    if (!window.confirm(`Remove stage "${row.name}" from this job card?`)) return;
    try { await api(`/api/job-sheets/${id}/stages/${row.id}`, { method: 'DELETE' }); await refresh(); }
    catch (err) { showToast(err.message, 'error'); }
  }
  async function uploadScan(file) {
    const fd = new FormData(); fd.append('file', file);
    try { await api(`/api/job-sheets/${id}/scan`, { method: 'POST', body: fd }); setScanVer(v => v + 1); await refresh(); showToast('Scan uploaded'); }
    catch (err) { showToast(err.message, 'error'); }
  }
  async function removeScan() {
    if (!window.confirm('Remove the uploaded scan?')) return;
    try { await api(`/api/job-sheets/${id}/scan`, { method: 'DELETE' }); await refresh(); }
    catch (err) { showToast(err.message, 'error'); }
  }
  async function deleteSheet() {
    if (!window.confirm(`Delete job card ${d.jc_no} and all its stages?`)) return;
    try { await api(`/api/job-sheets/${id}`, { method: 'DELETE' }); onDeleted(); }
    catch (err) { showToast(err.message, 'error'); }
  }

  const rows = d ? d.stages.filter(r => filter === 'all' ? true : filter === 'qc' ? (r.end_date && !r.qc_sign_by) : !r.end_date) : [];
  const workerOptions = [{ value: '', label: '—' }, ...workers.filter(w => w.active).map(w => ({ value: String(w.id), label: w.name }))];

  return (
    <Sheet open onOpenChange={v => !v && onClose()}>
      <FloatingPdfPanel open className="hidden w-[min(31vw,540px)] lg:flex">
        <p className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Job card scan</p>
        <div className="min-h-0 flex-1">
          {d?.scan_key && d.scan_type?.startsWith('image/') ? (
            <ScanImage url={`/api/job-sheets/${id}/scan?v=${scanVer}`} onReplace={canProduction ? uploadScan : null} onRemove={canProduction ? removeScan : null} />
          ) : (
            <PdfInlinePreview key={`${d?.scan_key || 'none'}-${scanVer}`} url={d?.scan_key ? `/api/job-sheets/${id}/scan?v=${scanVer}` : undefined}
              onPick={canProduction ? uploadScan : undefined} onRemove={canProduction && d?.scan_key ? removeScan : undefined}
              accept=".pdf,image/png,image/jpeg,image/webp" uploadLabel="Upload job card scan (PDF or photo)" />
          )}
        </div>
      </FloatingPdfPanel>
      <SheetContent className="flex w-full flex-col gap-0 p-0 data-[side=right]:sm:w-[62vw] data-[side=right]:sm:max-w-none"
        onPointerDownOutside={e => { if (e.target.closest('[data-pdf-panel]')) e.preventDefault(); }}
        onOpenAutoFocus={e => e.preventDefault()}>
        <SheetHeader className="border-b px-4 py-3">
          <SheetTitle className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>{d ? (d.job_number || d.jc_no) : 'Job Card'}</span>
            {d && <span className="text-sm font-normal text-muted-foreground">{d.jc_no} · {d.project_no || 'No project'}</span>}
            {d && <span className="ml-auto pr-8 text-sm font-normal tnum">{d.done} / {d.total} stages</span>}
          </SheetTitle>
        </SheetHeader>

        {!d ? <p className="p-8 text-center text-sm text-muted-foreground">Loading…</p> : (
          <>
            <div className="border-b px-4 py-2">
              <button type="button" onClick={() => setShowHeader(v => !v)} className="flex w-full items-center gap-2 text-left text-xs text-muted-foreground">
                <span>Drawing approved: {d.drawing_approved_on ? formatDate(d.drawing_approved_on) : '—'} · IBR/BVI: {d.ibr_bvi || '—'} · Start: {d.start_date ? formatDate(d.start_date) : '—'} · End: {d.end_date ? formatDate(d.end_date) : '—'}</span>
                <ChevronDownIcon className={`ml-auto size-4 transition-transform ${showHeader ? 'rotate-180' : ''}`} />
              </button>
              {showHeader && (
                <div className="mt-2 grid gap-2 sm:grid-cols-4">
                  <HeaderField label="Job number" value={d.job_number} disabled={!canProduction} onSave={v => patch({ job_number: v })} />
                  <HeaderField label="Drawing approved on" type="date" value={d.drawing_approved_on} disabled={!canProduction} onSave={v => patch({ drawing_approved_on: v })} />
                  <HeaderField label="IBR/BVI" value={d.ibr_bvi} disabled={!canProduction} onSave={v => patch({ ibr_bvi: v })} />
                  <HeaderField label="Drg. nos." value={d.drg_nos} disabled={!canProduction} onSave={v => patch({ drg_nos: v })} />
                  <HeaderField label="Boiler plate nos." value={d.boiler_plate_nos} disabled={!canProduction} onSave={v => patch({ boiler_plate_nos: v })} />
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 border-b px-4 py-2">
              {[['all', 'All'], ['open', 'Open'], ['qc', 'Waiting on QC']].map(([k, l]) => (
                <Button key={k} size="xs" variant={filter === k ? 'default' : 'outline'} onClick={() => setFilter(k)}>{l}</Button>
              ))}
              <div className="flex-1" />
              {canProduction && <Button size="xs" variant="ghost" onClick={addStage}><PlusIcon /> Stage</Button>}
            </div>

            <div className="min-h-0 flex-1 overflow-auto">
              <table className="w-full min-w-[980px] border-collapse text-xs">
                <thead className="sticky top-0 z-10 bg-background shadow-[0_1px_0_var(--border)]">
                  <tr className="text-left text-muted-foreground">
                    <th className="sticky left-0 z-20 w-10 bg-background px-2 py-2">#</th>
                    <th className="sticky left-10 z-20 min-w-[200px] bg-background px-2 py-2">Production stage</th>
                    <th className="px-2 py-2">Fitter / welder</th><th className="px-2 py-2">Start</th><th className="px-2 py-2">End</th>
                    <th className="px-2 py-2">Prod. sign</th><th className="px-2 py-2">Inspection</th>
                    <th className="px-2 py-2">Test certificate</th><th className="px-2 py-2">QC sign</th>
                    <th className="px-2 py-2">Remarks</th><th className="w-28 px-2 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => {
                    const st = stageState(r);
                    const isCurrent = !r.end_date && d.current_stage?.id === r.id;
                    return (
                      <tr key={r.id} ref={isCurrent ? curRef : null} className={`border-t ${STATE_TONE[st]} ${isCurrent ? 'outline outline-1 -outline-offset-1 outline-primary/60' : ''}`}>
                        <td className={`sticky left-0 bg-background px-2 py-1.5 tnum text-muted-foreground`}>{r.sort_order}</td>
                        <td className="sticky left-10 bg-background px-2 py-1.5 font-medium">{r.name}</td>
                        <td className="px-2 py-1">
                          {canProduction && !r.qc_sign_by ? (
                            <select value={r.fitter_employee_id || ''} onChange={e => stage(r, { action: 'edit', fitter_employee_id: e.target.value || null })}
                              className="h-7 w-32 rounded border bg-transparent px-1">
                              {workerOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                            </select>
                          ) : (r.fitter_name || '—')}
                          <ExtraWorkers r={r} workers={workers} disabled={!canProduction || !!r.qc_sign_by} onChange={ids => stage(r, { action: 'edit', extra_workers: ids })} />
                        </td>
                        <td className="px-2 py-1"><DateCell value={r.start_date} disabled={!canProduction || !!r.qc_sign_by} onSave={v => stage(r, { action: 'edit', start_date: v })} /></td>
                        <td className="px-2 py-1"><DateCell value={r.end_date} disabled={!canProduction || !!r.qc_sign_by} onSave={v => stage(r, { action: 'edit', end_date: v })} /></td>
                        <td className="px-2 py-1.5">{r.production_sign_by || '—'}</td>
                        <td className="px-2 py-1.5">{r.inspection_date ? formatDate(r.inspection_date) : '—'}</td>
                        <td className="px-2 py-1.5">{r.test_certificate_no ? `${r.test_certificate_no}${r.test_certificate_cast_no ? ` · ${r.test_certificate_cast_no}` : ''}` : '—'}</td>
                        <td className="px-2 py-1.5">{r.qc_sign_by || '—'}</td>
                        <td className="px-2 py-1"><RemarkCell value={r.remarks} disabled={!canProduction} onSave={v => stage(r, { action: 'edit', remarks: v })} /></td>
                        <td className="px-2 py-1">
                          <div className="flex items-center gap-1">
                            {st === 'pending' && canProduction && <Button size="xs" onClick={() => stage(r, { action: 'start' })}><PlayIcon /> Start</Button>}
                            {st === 'in_progress' && canProduction && <Button size="xs" onClick={() => stage(r, { action: 'finish' })}><CheckIcon /> Finish</Button>}
                            {st === 'done' && (canQc
                              ? <Button size="xs" variant="outline" onClick={() => setQcRow(r)}><ShieldCheckIcon /> QC sign</Button>
                              : <Badge variant="outline" className="text-warning">Waiting on QC</Badge>)}
                            {st === 'qc_signed' && <Badge variant="outline" className="text-success">QC ✓</Badge>}
                            {st !== 'pending' && (canProduction || canQc) && (
                              <Button size="icon-xs" variant="ghost" title="Reopen stage" onClick={() => window.confirm('Reopen this stage? Its dates and signs are cleared.') && stage(r, { action: 'reopen' })}><RotateCcwIcon /></Button>
                            )}
                            {st === 'pending' && canProduction && (
                              <Button size="icon-xs" variant="ghost" title="Remove stage" onClick={() => removeStage(r)}><Trash2Icon /></Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {rows.length === 0 && <p className="p-6 text-center text-sm text-muted-foreground">Nothing here.</p>}
            </div>

            <div className="flex flex-wrap items-end gap-3 border-t bg-background px-4 py-3">
              <div className="min-w-[220px] flex-1">
                <Label className="text-xs text-muted-foreground">Notes</Label>
                <Textarea defaultValue={d.notes || ''} rows={2} disabled={!canProduction} onBlur={e => e.target.value !== (d.notes || '') && patch({ notes: e.target.value })} />
              </div>
              <SignBox label="Production I/C" by={d.production_sign_by} at={d.production_sign_at} can={canProduction} onSign={() => patch({ sign: 'production' })} />
              <SignBox label="QC" by={d.qc_sign_by} at={d.qc_sign_at} can={canQc} onSign={() => patch({ sign: 'qc' })} />
              <Button variant="outline" onClick={() => printSheet(d)}><PrinterIcon /> Print</Button>
              {canProduction && <Button variant="ghost" size="icon" title="Delete job card" onClick={deleteSheet}><Trash2Icon /></Button>}
            </div>
          </>
        )}
        {qcRow && d && <QcDialog row={qcRow} projectId={d.project_id} onClose={() => setQcRow(null)}
          onDone={() => { setQcRow(null); refresh(); }} />}
      </SheetContent>
    </Sheet>
  );
}

function HeaderField({ label, value, onSave, disabled, type = 'text' }) {
  return (
    <div className="flex flex-col gap-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Input type={type} defaultValue={value || ''} disabled={disabled} className="h-8"
        onBlur={e => e.target.value !== (value || '') && onSave(e.target.value)} />
    </div>
  );
}

function DateCell({ value, onSave, disabled }) {
  if (disabled) return <span>{value ? formatDate(value) : '—'}</span>;
  return <input type="date" defaultValue={value || ''} key={value || 'x'} className="h-7 w-32 rounded border bg-transparent px-1"
    onBlur={e => e.target.value !== (value || '') && onSave(e.target.value)} />;
}

function RemarkCell({ value, onSave, disabled }) {
  if (disabled) return <span>{value || '—'}</span>;
  return <input defaultValue={value || ''} key={value || 'x'} placeholder="…" className="h-7 w-36 rounded border bg-transparent px-1"
    onBlur={e => e.target.value !== (value || '') && onSave(e.target.value)} />;
}

function SignBox({ label, by, at, can, onSign }) {
  return (
    <div className="flex min-w-[130px] flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label} signature</span>
      {by ? <span className="text-sm font-medium">{by}<span className="block text-xs font-normal text-muted-foreground">{at ? formatDate(String(at).slice(0, 10)) : ''}</span></span>
        : can ? <Button size="sm" variant="outline" onClick={onSign}>Sign</Button> : <span className="text-sm text-muted-foreground">—</span>}
    </div>
  );
}

function QcDialog({ row, projectId, onClose, onDone }) {
  const [date, setDate] = useState(todayISO());
  const [certId, setCertId] = useState(null);
  const [certs, setCerts] = useState([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api(`/api/test-certificates${projectId ? `?project_id=${projectId}` : ''}`).then(setCerts).catch(() => {});
  }, [projectId]);
  const cert = certs.find(c => c.id === certId);
  async function sign() {
    setBusy(true);
    try {
      await api(`/api/job-sheets/${row.sheet_id}/stages/${row.id}`, { method: 'PATCH', body: { action: 'qc', inspection_date: date, test_certificate_id: certId } });
      showToast('Stage QC-signed'); onDone();
    } catch (err) { showToast(err.message, 'error'); setBusy(false); }
  }
  return (
    <Dialog open onOpenChange={v => !v && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle>QC sign · {row.name}</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1"><Label>Inspection date</Label>
            <Input type="date" value={date} onChange={e => setDate(e.target.value)} /></div>
          <div className="flex flex-col gap-1"><Label>Test certificate</Label>
            <div className="flex gap-2">
              <Button type="button" variant="outline" className="flex-1 justify-start font-normal" onClick={() => setPickerOpen(true)}>
                {cert ? `${cert.certificate_no} · ${cert.cast_no}` : 'Link a certificate… (optional)'}
              </Button>
              {certId && <Button type="button" variant="ghost" onClick={() => setCertId(null)}>Clear</Button>}
            </div>
          </div>
        </div>
        <DialogFooter><Button onClick={sign} disabled={busy}>Sign as QC</Button></DialogFooter>
        <CertPicker open={pickerOpen} onOpenChange={setPickerOpen} title="Link test certificate" certificates={certs}
          project={projectId ? { id: projectId } : null} onPick={setCertId} />
      </DialogContent>
    </Dialog>
  );
}

// Paper-style printout in a new window (same columns as the client's form).
function printSheet(d) {
  const esc = s => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const f = v => (v ? formatDate(v) : '');
  const rows = d.stages.map(r => `<tr><td>${r.sort_order}</td><td>${esc(r.name)}</td><td>${esc(r.fitter_name)}</td><td>${f(r.start_date)}</td><td>${f(r.end_date)}</td><td>${esc(r.production_sign_by)}</td><td>${f(r.inspection_date)}</td><td>${esc(r.test_certificate_no)}</td><td>${esc(r.qc_sign_by)}</td><td>${esc(r.remarks)}</td></tr>`).join('');
  const w = window.open('', '_blank');
  if (!w) return;
  w.document.write(`<html><head><title>${esc(d.jc_no)}</title><style>
    body{font:11px Arial,sans-serif;margin:16px}h1{text-align:center;font-size:16px;margin:0 0 6px}
    table{border-collapse:collapse;width:100%}td,th{border:1px solid #000;padding:3px 4px;text-align:left}th{font-size:10px}
    .h td{font-weight:bold;font-size:12px}</style></head><body><h1>JOB CARD</h1>
    <table class="h"><tr><td colspan="2">JOB NUMBER : ${esc(d.job_number)}</td><td colspan="2">DRAWING APPROVED ON : ${f(d.drawing_approved_on)}</td><td colspan="2">IBR/BVI : ${esc(d.ibr_bvi)}</td></tr>
    <tr><td colspan="2">START DATE : ${f(d.start_date)}</td><td colspan="4">DRG.NOS. : ${esc(d.drg_nos)}</td></tr>
    <tr><td colspan="2">END DATE : ${f(d.end_date)}</td><td colspan="4">BOILER PLATE NOS. : ${esc(d.boiler_plate_nos)}</td></tr></table>
    <table><tr><th>S.NO.</th><th>PRODUCTION STAGES</th><th>FITTER/WELDER</th><th>START DATE</th><th>END DATE</th><th>PRODUCTION SIGN</th><th>INSPECTION DATE</th><th>TEST CERTIFICATE NUMBER</th><th>QC SIGN</th><th>REMARKS</th></tr>${rows}</table>
    <p><b>NOTES :</b> ${esc(d.notes)}</p><p><b>PRODUCTION I/C SIGNATURE:</b> ${esc(d.production_sign_by)} &nbsp;&nbsp;&nbsp; <b>QC SIGNATURE:</b> ${esc(d.qc_sign_by)}</p>
    <script>window.onload=()=>window.print()</script></body></html>`);
  w.document.close();
}

// Photo of the paper card: fit-to-panel with simple zoom; Replace/Remove like the PDF viewer.
function ScanImage({ url, onReplace, onRemove }) {
  const [zoom, setZoom] = useState(1);
  const input = useRef(null);
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border bg-muted/10">
      <div className="flex shrink-0 items-center gap-1 border-b p-1.5">
        <Button size="xs" variant="outline" onClick={() => setZoom(z => Math.max(0.5, z - 0.25))}>−</Button>
        <Button size="xs" variant="outline" onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</Button>
        <Button size="xs" variant="outline" onClick={() => setZoom(z => Math.min(4, z + 0.25))}>+</Button>
        <div className="flex-1" />
        {onReplace && <>
          <input ref={input} type="file" accept=".pdf,image/png,image/jpeg,image/webp" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onReplace(f); }} />
          <Button size="xs" variant="outline" onClick={() => input.current?.click()}>Replace</Button>
        </>}
        {onRemove && <Button size="xs" variant="ghost" onClick={onRemove}>Remove</Button>}
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-muted/30 p-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt="Job card scan" style={{ width: `${zoom * 100}%`, maxWidth: 'none' }} className="rounded-md border bg-white" />
      </div>
    </div>
  );
}

// Extra fitters/welders on a stage: removable chips + a small "+" picker (the first stays in the dropdown).
function ExtraWorkers({ r, workers, disabled, onChange }) {
  const ids = (r.extra_worker_ids ? String(r.extra_worker_ids).split(',') : []).map(Number);
  const names = ids.map(id => workers.find(w => w.id === id)?.name || `#${id}`);
  if (disabled && !ids.length) return null;
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1">
      {ids.map((id, i) => (
        <span key={id} className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]">
          {names[i]}
          {!disabled && <button type="button" aria-label="Remove worker" onClick={() => onChange(ids.filter(x => x !== id))}>×</button>}
        </span>
      ))}
      {!disabled && (
        <select value="" onChange={e => e.target.value && onChange([...ids, Number(e.target.value)])}
          className="h-5 w-14 rounded border bg-transparent px-0.5 text-[11px]" aria-label="Add worker">
          <option value="">+ add</option>
          {workers.filter(w => w.active && w.id !== r.fitter_employee_id && !ids.includes(w.id)).map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
      )}
    </div>
  );
}
