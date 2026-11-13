'use client';

// The ITP traveler: a job card made from an ITP template (docs/gulf-coast-asme-plan.md). One row per
// inspection point, grouped by section, with its customer inspection type (H hold / W witness / R review),
// its state, and — when it cannot move — exactly what blocks it. The server refuses the same things
// (lib/quality-gate.mjs is run in every write route), so the buttons here are only shortcuts.
import { Fragment, useEffect, useMemo, useState } from 'react';
import { api, showToast } from '@/lib/client';
import { formatDate } from '@/lib/format';
import { todayISO } from '@/lib/date';
import { pointType, weldsFor } from '@/lib/quality-gate.mjs';
import { evaluate, describeRule, pickRule } from '@/lib/acceptance.mjs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { RaiseNcrDialog } from '@/components/NcrPanel';
import { ChevronRightIcon, PlayIcon, CheckIcon, ShieldCheckIcon, ClipboardPlusIcon, BellIcon, StampIcon, BanIcon, RotateCcwIcon, WrenchIcon, PlusIcon, Trash2Icon } from 'lucide-react';

const TYPE_TONE = { H: 'border-danger/40 text-danger', W: 'border-warning/50 text-warning', R: 'text-muted-foreground' };
const TYPE_TITLE = { H: 'Hold point: does not proceed without the customer’s authorization', W: 'Witness point: customer notified 48 hours before', R: 'Review point' };

function rowStatus(r, st, failed) {
  if (r.not_applicable) return { label: 'N/A', tone: 'text-muted-foreground' };
  if (st?.cleared) return { label: 'Cleared', tone: 'text-success' };
  if (failed) return { label: 'Failed', tone: 'text-danger' };
  if (st?.blocked) return { label: 'Blocked', tone: 'text-danger' };
  if (r.qc_sign_by && pointType(r.point_type) === 'H') return { label: 'Waiting customer release', tone: 'text-warning' };
  if (r.end_date || r.qc_only) return { label: 'Waiting QC', tone: 'text-warning' };
  if (r.start_date) return { label: 'In progress', tone: 'text-primary' };
  return { label: 'Open', tone: 'text-muted-foreground' };
}

export default function ItpTraveler({ d, canProduction, canQc, onChanged }) {
  const [open, setOpen] = useState(() => new Set());
  const [inspect, setInspect] = useState(null);
  const [ncrFor, setNcrFor] = useState(null);
  const itp = d.itp || { states: [], records: [], ncrs: [], welds: [] };
  const stateOf = id => itp.states.find(s => s.id === id);
  const recordsOf = id => itp.records.filter(r => r.job_sheet_stage_id === id);
  const ncrsOf = id => itp.ncrs.filter(n => n.job_sheet_stage_id === id);
  const latestFail = id => {
    const latest = new Map();
    for (const r of recordsOf(id)) latest.set(`${r.weld_id ?? ''}|${r.test_type.toUpperCase()}`, r);
    return [...latest.values()].find(r => r.result === 'fail') || null;
  };

  const sections = useMemo(() => {
    const out = [];
    for (const r of d.stages) {
      const last = out[out.length - 1];
      if (last && last.name === r.section) last.rows.push(r); else out.push({ name: r.section || '—', rows: [r] });
    }
    return out;
  }, [d.stages]);

  const counts = useMemo(() => {
    const c = { cleared: 0, blocked: 0, open: 0 };
    for (const s of itp.states) { if (s.cleared) c.cleared++; else if (s.blocked) c.blocked++; else c.open++; }
    return c;
  }, [itp.states]);

  async function act(row, body, ok) {
    try {
      await api(`/api/job-sheets/${d.id}/stages/${row.id}`, { method: 'PATCH', body });
      if (ok) showToast(ok);
      await onChanged();
    } catch (err) { showToast(err.message, 'error'); }
  }
  async function repair(n) {
    const notes = window.prompt(`${n.ncr_no}: describe the repair done`);
    if (!notes) return;
    try { await api(`/api/ncrs/${n.id}/repair`, { method: 'POST', body: { notes } }); showToast('Repair recorded — QC re-inspects next'); await onChanged(); }
    catch (err) { showToast(err.message, 'error'); }
  }
  const toggle = id => setOpen(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b px-4 py-2 text-xs">
        <span><b className="tnum text-success">{counts.cleared}</b> cleared</span>
        <span><b className="tnum text-danger">{counts.blocked}</b> blocked</span>
        <span><b className="tnum">{counts.open}</b> open</span>
        <span className="text-muted-foreground">ITP rev {d.itp_revision || '—'} · PO {d.customer_po || '—'} · Item {d.item_number || '—'}</span>
        <span className="ml-auto text-muted-foreground">Prepared for review. Certification stays with the manufacturer and the Authorized Inspector.</span>
      </div>
      <table className="w-full min-w-[900px] border-collapse text-xs">
        <thead className="sticky top-0 z-10 bg-background shadow-[0_1px_0_var(--border)]">
          <tr className="text-left text-muted-foreground">
            <th className="w-8 px-2 py-2" /><th className="w-14 px-2 py-2">Point</th><th className="px-2 py-2">Inspection</th>
            <th className="w-12 px-2 py-2">Doc</th><th className="w-12 px-2 py-2">Type</th><th className="w-40 px-2 py-2">Status</th>
            <th className="px-2 py-2">Waiting on</th><th className="w-64 px-2 py-2" />
          </tr>
        </thead>
        <tbody>
          {sections.map(sec => (
            <Fragment key={sec.name}>
              <tr><td colSpan={8} className="bg-muted/40 px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{sec.name}</td></tr>
              {sec.rows.map(r => {
                const st = stateOf(r.id);
                const fail = latestFail(r.id);
                const status = rowStatus(r, st, fail);
                const t = pointType(r.point_type);
                const recs = recordsOf(r.id), ncrs = ncrsOf(r.id);
                const waiting = st?.blocked ? st.blockedBy.map(b => `${b.item_key}: ${b.reasons.join(', ')}`).join(' · ') : (st && !st.cleared ? st.reasons.join(', ') : '');
                const isOpen = open.has(r.id);
                return (
                  <Fragment key={r.id}>
                    <tr className={`border-t ${st?.cleared ? 'bg-success-surface/40' : st?.blocked || fail ? 'bg-danger/5' : ''}`}>
                      <td className="px-2 py-1.5">
                        <button type="button" aria-label="Details" onClick={() => toggle(r.id)} className="text-muted-foreground">
                          <ChevronRightIcon className={`size-4 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                        </button>
                      </td>
                      <td className="px-2 py-1.5 tnum font-medium">{r.item_key}</td>
                      <td className="px-2 py-1.5">
                        <span className="font-medium">{r.name}</span>
                        {(r.test_type || recs.length > 0 || ncrs.length > 0) && (
                          <span className="ml-2 text-muted-foreground">
                            {r.test_type && `${r.test_type}${r.per_weld ? ' per weld' : ''}`}
                            {recs.length > 0 && ` · ${recs.length} inspection${recs.length > 1 ? 's' : ''}`}
                            {ncrs.length > 0 && ` · ${ncrs.length} NCR`}
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-muted-foreground">{r.doc_code || '—'}</td>
                      <td className="px-2 py-1.5"><Badge variant="outline" title={TYPE_TITLE[t]} className={`px-1.5 py-0 text-[10px] ${TYPE_TONE[t]}`}>{r.point_type || 'R'}</Badge></td>
                      <td className={`px-2 py-1.5 font-medium ${status.tone}`}>{status.label}</td>
                      <td className="px-2 py-1.5 text-muted-foreground">{waiting || '—'}</td>
                      <td className="px-2 py-1">
                        <div className="flex flex-wrap items-center justify-end gap-1">
                          {!r.not_applicable && !r.qc_sign_by && <>
                            {canProduction && !r.qc_only && !r.start_date && (
                              <Button size="xs" disabled={st?.blocked} title={st?.blocked ? 'Blocked' : 'Stamps today as the start date'} onClick={() => act(r, { action: 'start' })}><PlayIcon /> Start</Button>
                            )}
                            {canProduction && !r.qc_only && r.start_date && !r.end_date && (
                              <Button size="xs" onClick={() => act(r, { action: 'finish' })}><CheckIcon /> Finish</Button>
                            )}
                            {canQc && t === 'W' && !r.notified_at && (
                              <Button size="xs" variant="outline" title="Record that the customer was given notice" onClick={() => act(r, { action: 'notify' }, 'Notice recorded')}><BellIcon /> Notice sent</Button>
                            )}
                            {(canQc || canProduction) && (
                              <Button size="xs" variant="outline" onClick={() => setInspect(r)}><ClipboardPlusIcon /> Inspection</Button>
                            )}
                            {canQc && (r.end_date || r.qc_only) && (
                              <Button size="xs" variant="outline" disabled={st?.blocked || !!fail} onClick={() => act(r, { action: 'qc', inspection_date: todayISO() }, 'QC-signed')}><ShieldCheckIcon /> QC sign</Button>
                            )}
                          </>}
                          {canQc && t === 'H' && r.qc_sign_by && !r.released_at && (
                            <Button size="xs" onClick={() => {
                              const ref = window.prompt('How did the customer authorize this hold point? (email, signed ITP, inspector on site)');
                              if (ref) act(r, { action: 'release', release_ref: ref }, 'Customer release recorded');
                            }}><StampIcon /> Customer release</Button>
                          )}
                          {canQc && !r.qc_sign_by && !r.not_applicable && !recs.length && (
                            <Button size="icon-xs" variant="ghost" title="Not applicable to this job" onClick={() => {
                              const reason = window.prompt(`Why does point ${r.item_key} not apply to this job?`);
                              if (reason) act(r, { action: 'na', reason });
                            }}><BanIcon /></Button>
                          )}
                          {(canQc || (canProduction && !r.qc_sign_by)) && (r.start_date || r.qc_sign_by || r.not_applicable) && (
                            <Button size="icon-xs" variant="ghost" title="Reopen this point (clears its dates, signs and release)"
                              onClick={() => window.confirm(`Reopen point ${r.item_key}? Points that depend on it are blocked again.`) && act(r, { action: 'reopen' })}><RotateCcwIcon /></Button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="border-t bg-muted/20">
                        <td />
                        <td colSpan={7} className="px-2 py-2">
                          <PointDetail r={r} recs={recs} ncrs={ncrs} welds={itp.welds} canProduction={canProduction}
                            onNcr={rec => setNcrFor({ stage: r, rec })} onRepair={repair} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </Fragment>
          ))}
        </tbody>
      </table>
      {inspect && <InspectionDialog stage={inspect} projectId={d.project_id} welds={itp.welds} onClose={() => setInspect(null)}
        onSaved={async (rec) => { setInspect(null); await onChanged(); if (rec.result === 'fail') setNcrFor({ stage: inspect, rec: { id: rec.id, weld_id: rec.weld_id, test_type: rec.test_type } }); }} />}
      {ncrFor && <RaiseNcrDialog open onOpenChange={o => !o && setNcrFor(null)} projectId={d.project_id}
        qcRecordId={ncrFor.rec?.id} stageId={ncrFor.stage.id} weldId={ncrFor.rec?.weld_id || undefined}
        defaultDescription={ncrFor.rec ? `${ncrFor.rec.test_type} failed on point ${ncrFor.stage.item_key} ${ncrFor.stage.name}${ncrFor.rec.weld_id ? ` (weld ${itp.welds.find(w => w.id === ncrFor.rec.weld_id)?.weld_no || ''})` : ''}` : ''}
        onRaised={async () => { setNcrFor(null); await onChanged(); }} />}
    </div>
  );
}

function PointDetail({ r, recs, ncrs, welds, canProduction, onNcr, onRepair }) {
  const weldNo = id => welds.find(w => w.id === id)?.weld_no;
  const ncrForRec = id => ncrs.find(n => n.qc_record_id === id);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
        {r.requires && <span>Requires: {r.requires}</span>}
        {r.start_date && <span>Started {formatDate(r.start_date)}</span>}
        {r.end_date && <span>Finished {formatDate(r.end_date)} by {r.production_sign_by}</span>}
        {r.notified_at && <span>Notice by {r.notified_by}, {formatDate(String(r.notified_at).slice(0, 10))}</span>}
        {r.qc_sign_by && <span>QC-signed by {r.qc_sign_by}</span>}
        {r.released_at && <span>Customer release: {r.release_ref} (recorded by {r.released_by})</span>}
        {r.not_applicable ? <span>Not applicable: {r.na_reason}</span> : null}
      </div>
      {recs.length === 0 ? <p className="text-muted-foreground">No inspections recorded.</p> : (
        <table className="w-full text-xs">
          <thead><tr className="text-left text-muted-foreground"><th className="py-1">#</th><th>Test</th><th>Weld</th><th>Report</th><th>Date</th><th>Values</th><th>Result</th><th /></tr></thead>
          <tbody>
            {recs.map(x => {
              const superseded = recs.some(y => y.supersedes_id === x.id);
              const ncr = ncrForRec(x.id);
              return (
                <tr key={x.id} className={`border-t ${superseded ? 'text-muted-foreground' : ''}`}>
                  <td className="py-1 tnum">{x.id}</td>
                  <td>{x.test_type}{superseded && ' (retested)'}</td>
                  <td>{x.weld_id ? weldNo(x.weld_id) : '—'}</td>
                  <td>{x.has_report ? <a className="text-primary underline" href={`/api/qc-records/${x.id}/report`} target="_blank" rel="noreferrer">{x.reference_no || 'PDF'}</a> : (x.reference_no || '—')}</td>
                  <td>{x.tested_on ? formatDate(x.tested_on) : '—'}</td>
                  <td>{x.measurements.length ? x.measurements.map(m => (
                    <span key={m.id} className={`mr-2 ${m.verdict === 'fail' ? 'font-medium text-danger' : ''}`}
                      title={m.rule_id ? `Rule v${m.rule_version}: ${describeRule({ ...m, unit: m.rule_unit })} · ${m.rule_source}` : 'No rule for this characteristic'}>
                      {m.characteristic} {m.value} {m.unit}{m.location ? ` @ ${m.location}` : ''}
                    </span>)) : '—'}</td>
                  <td className={x.result === 'fail' ? 'font-medium text-danger' : x.result === 'pass' ? 'text-success' : ''}>{x.result}</td>
                  <td className="text-right">
                    {x.result === 'fail' && !superseded && !ncr && <Button size="xs" variant="outline" onClick={() => onNcr(x)}>Raise NCR</Button>}
                    {ncr && <span className="text-muted-foreground">{ncr.ncr_no}</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {ncrs.map(n => (
        <div key={n.id} className="flex flex-wrap items-center gap-2 rounded-md border bg-background px-2 py-1.5">
          <span className="font-medium">{n.ncr_no}</span>
          <Badge variant="outline">{n.status}{n.disposition ? ` · ${n.disposition}` : ''}</Badge>
          {n.repair_at ? <span className="text-muted-foreground">repair recorded</span>
            : ['rework', 'repair'].includes(n.disposition) && <span className="text-warning">waiting for the repair</span>}
          {n.qc_verified_at && <span className="text-success">QC-verified</span>}
          {canProduction && n.status === 'dispositioned' && ['rework', 'repair'].includes(n.disposition) && !n.repair_at && (
            <Button size="xs" className="ml-auto" onClick={() => onRepair(n)}><WrenchIcon /> Record repair</Button>
          )}
        </div>
      ))}
    </div>
  );
}

// One inspection attempt. Measured values are judged live against the acceptance rules; a value outside
// its rule makes the inspection fail (the server checks again). A retest is a new record: the old one stays.
function InspectionDialog({ stage, projectId, welds, onClose, onSaved }) {
  const candidates = stage.per_weld ? weldsFor(stage, welds) : welds;
  const [f, setF] = useState({ test_type: stage.test_type || '', weld_id: candidates.length === 1 ? String(candidates[0].id) : '', reference_no: '', inspector: '', tested_on: todayISO(), notes: '', result: '' });
  const [rows, setRows] = useState([{ characteristic: '', value: '', unit: '', location: '' }]);
  const [rules, setRules] = useState([]);
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api('/api/acceptance-rules').then(setRules).catch(() => {}); }, []);
  const filled = rows.filter(r => String(r.characteristic).trim() || String(r.value).trim());
  const ev = evaluate(filled, rules, {});
  const set = (i, k, v) => setRows(rs => rs.map((r, j) => {
    if (j !== i) return r;
    const next = { ...r, [k]: v };
    if (k === 'characteristic' && !r.unit) { const rule = pickRule(rules, v, {}); if (rule) next.unit = rule.unit; }
    return next;
  }));
  const autoResult = ev.anyFail ? 'fail' : filled.length && ev.rows.every(r => r.verdict === 'pass') ? 'pass' : '';
  const result = autoResult === 'fail' ? 'fail' : (f.result || autoResult || 'pending');
  const characteristics = [...new Set(rules.filter(r => !r.retired_at).map(r => r.characteristic))];

  async function save() {
    if (!f.test_type.trim()) return showToast('Test type is required', 'error');
    if (stage.per_weld && !f.weld_id) return showToast('Pick the weld', 'error');
    setBusy(true);
    try {
      const rec = await api('/api/qc-records', { method: 'POST', body: {
        project_id: projectId, job_sheet_stage_id: stage.id, weld_id: f.weld_id ? Number(f.weld_id) : undefined, test_type: f.test_type,
        reference_no: f.reference_no, inspector: f.inspector, tested_on: f.tested_on, notes: f.notes, result, measurements: filled } });
      if (file) {
        const fd = new FormData(); fd.append('file', file);
        try { await api(`/api/qc-records/${rec.id}/report`, { method: 'POST', body: fd }); }
        catch (err) { showToast(`Saved, but the report did not upload: ${err.message}`, 'error'); }
      }
      showToast(rec.result === 'fail' ? 'Inspection recorded as FAILED' : `Inspection recorded (${rec.result})`);
      onSaved({ ...rec, weld_id: f.weld_id ? Number(f.weld_id) : null, test_type: f.test_type });
    } catch (err) { showToast(err.message, 'error'); setBusy(false); }
  }

  return (
    <Dialog open onOpenChange={v => !v && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader><DialogTitle>Inspection · {stage.item_key} {stage.name}</DialogTitle></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="flex flex-col gap-1"><Label>Test</Label><Input value={f.test_type} onChange={e => setF({ ...f, test_type: e.target.value })} placeholder="RT, VT, Hydro…" /></div>
          <div className="flex flex-col gap-1"><Label>Weld{stage.per_weld ? ' *' : ''}</Label>
            <Select value={f.weld_id || 'none'} onValueChange={v => setF({ ...f, weld_id: v === 'none' ? '' : v })}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {!stage.per_weld && <SelectItem value="none">—</SelectItem>}
                {candidates.map(w => <SelectItem key={w.id} value={String(w.id)}>{w.weld_no}{w.joint ? ` · ${w.joint}` : ''}</SelectItem>)}
              </SelectContent>
            </Select>
            {stage.per_weld && !candidates.length && <span className="text-xs text-danger">No weld on the register lists {stage.test_type}</span>}
          </div>
          <div className="flex flex-col gap-1"><Label>Date</Label><Input type="date" value={f.tested_on} onChange={e => setF({ ...f, tested_on: e.target.value })} /></div>
          <div className="flex flex-col gap-1"><Label>Report no.</Label><Input value={f.reference_no} onChange={e => setF({ ...f, reference_no: e.target.value })} /></div>
          <div className="flex flex-col gap-1"><Label>Inspector</Label><Input value={f.inspector} onChange={e => setF({ ...f, inspector: e.target.value })} /></div>
          <div className="flex flex-col gap-1"><Label>Report PDF</Label><Input type="file" accept="application/pdf" onChange={e => setFile(e.target.files?.[0] || null)} /></div>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Measured values (optional)</Label>
          <datalist id="itp-characteristics">{characteristics.map(c => <option key={c} value={c} />)}</datalist>
          {rows.map((m, i) => {
            const evRow = ev.rows[filled.indexOf(m)];
            const rule = pickRule(rules, m.characteristic, {});
            return (
              <div key={i} className="grid grid-cols-[1.4fr_0.8fr_0.7fr_1fr_auto] items-center gap-2">
                <Input list="itp-characteristics" placeholder="Characteristic" value={m.characteristic} onChange={e => set(i, 'characteristic', e.target.value)} />
                <Input inputMode="decimal" placeholder="Value" value={m.value} onChange={e => set(i, 'value', e.target.value)} />
                <Input placeholder="Unit" value={m.unit} onChange={e => set(i, 'unit', e.target.value)} />
                <Input placeholder="Location" value={m.location} onChange={e => set(i, 'location', e.target.value)} />
                <span className={`w-28 text-xs ${evRow?.verdict === 'fail' ? 'font-medium text-danger' : evRow?.verdict === 'pass' ? 'text-success' : 'text-muted-foreground'}`}>
                  {evRow?.verdict ? evRow.verdict.toUpperCase() : rule ? describeRule(rule) : m.characteristic ? 'no rule' : ''}
                </span>
              </div>
            );
          })}
          <div className="flex gap-2">
            <Button type="button" size="xs" variant="ghost" onClick={() => setRows(r => [...r, { characteristic: '', value: '', unit: '', location: '' }])}><PlusIcon /> Value</Button>
            {rows.length > 1 && <Button type="button" size="xs" variant="ghost" onClick={() => setRows(r => r.slice(0, -1))}><Trash2Icon /> Last</Button>}
          </div>
          {ev.errors.length > 0 && <p className="text-xs text-danger">{ev.errors.join('; ')}</p>}
        </div>
        <div className="grid gap-3 sm:grid-cols-[180px_1fr]">
          <div className="flex flex-col gap-1"><Label>Result</Label>
            <Select value={result} onValueChange={v => setF({ ...f, result: v })} disabled={autoResult === 'fail'}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="pass" disabled={ev.anyFail}>Pass</SelectItem>
                <SelectItem value="fail">Fail</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1"><Label>Notes</Label><Textarea rows={2} value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} /></div>
        </div>
        <p className="text-xs text-muted-foreground">A decided inspection is kept as recorded. To retest, record a new inspection: the earlier one stays in the history.</p>
        <DialogFooter><Button disabled={busy || ev.errors.length > 0} onClick={save}>Save inspection</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
