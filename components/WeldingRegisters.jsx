'use client';

// QC → Welding: the weld register for one project, the WPS list and the welders with their continuity
// per process (lib/qc-asme.mjs, six months without the process = lapsed). The ASME record package and the
// per-weld ITP points read these tables.
import { useCallback, useEffect, useState } from 'react';
import { api, showToast } from '@/lib/client';
import { formatDate } from '@/lib/format';
import { Card, CardHeader, CardTitle, CardContent, CardAction } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import SearchableSelect from '@/components/SearchableSelect';
import { PlusIcon, PencilIcon, Trash2Icon, CheckIcon, UploadIcon } from 'lucide-react';

const TABS = [['welds', 'Weld register'], ['wps', 'WPS'], ['welders', 'Welders']];

export default function WeldingRegisters({ projectId, canEdit = false, canApprove = false }) {
  const [tab, setTab] = useState('welds');
  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-1">{TABS.map(([k, l]) => <Button key={k} size="sm" variant={tab === k ? 'default' : 'outline'} onClick={() => setTab(k)}>{l}</Button>)}</div>
      {tab === 'welds' ? <Welds projectId={projectId} canEdit={canEdit} /> : tab === 'wps' ? <WpsList canEdit={canEdit} canApprove={canApprove} /> : <Welders canEdit={canEdit} />}
    </div>
  );
}

function Welds({ projectId, canEdit }) {
  const [data, setData] = useState(null);
  const [edit, setEdit] = useState(null);
  const [wps, setWps] = useState([]);
  const [bom, setBom] = useState([]);
  const load = useCallback(() => {
    if (!projectId) return;
    api(`/api/welds?project_id=${projectId}`).then(setData).catch(e => showToast(e.message, 'error'));
  }, [projectId]);
  useEffect(() => { setData(null); load(); }, [load]);
  useEffect(() => { api('/api/wps').then(setWps).catch(() => {}); }, []);
  useEffect(() => { if (projectId) api(`/api/projects/${projectId}/bom?all=1`).then(r => setBom(r.items || [])).catch(() => setBom([])); }, [projectId]);
  if (!projectId) return <Card><CardContent className="py-6 text-sm text-muted-foreground">Pick a project above to see its weld register.</CardContent></Card>;

  async function del(w) {
    if (!window.confirm(`Delete weld ${w.weld_no}?`)) return;
    try { await api(`/api/welds/${w.id}`, { method: 'DELETE' }); load(); } catch (e) { showToast(e.message, 'error'); }
  }
  const heats = hs => (hs?.length ? hs.map(h => h.heat).join(', ') : '—');
  return (
    <Card>
      <CardHeader>
        <CardTitle>Weld register</CardTitle>
        {canEdit && <CardAction><Button size="sm" onClick={() => setEdit({})}><PlusIcon /> Weld</Button></CardAction>}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {data?.problems?.length > 0 && (
          <div className="rounded-md border border-warning/40 bg-warning-surface/50 px-3 py-2 text-xs">
            <p className="font-medium text-warning">Welder qualification problems</p>
            <ul className="list-disc pl-4">{data.problems.map(p => <li key={p}>{p}</li>)}</ul>
          </div>
        )}
        {!data ? <p className="text-sm text-muted-foreground">Loading…</p> : data.welds.length === 0 ? <p className="text-sm text-muted-foreground">No welds recorded for this project.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-xs">
              <thead><tr className="text-left text-muted-foreground"><th className="py-1.5">Weld</th><th>Joint</th><th>Cat.</th><th>WPS</th><th>Welders</th><th>NDE</th><th>Part A · heats</th><th>Part B · heats</th><th>Welded</th><th /></tr></thead>
              <tbody>
                {data.welds.map(w => (
                  <tr key={w.id} className="border-t">
                    <td className="py-1.5 font-medium">{w.weld_no}</td><td>{w.joint || '—'}</td><td>{w.category || '—'}</td>
                    <td>{w.wps_no || '—'}{w.wps_status === 'draft' && <span className="text-warning"> (draft)</span>}</td>
                    <td>{w.welder_stamps || '—'}</td><td>{w.nde || '—'}</td>
                    <td>{heats(w.heats_a)}</td><td>{heats(w.heats_b)}</td>
                    <td>{w.welded_on ? formatDate(w.welded_on) : '—'}</td>
                    <td className="text-right">{canEdit && <>
                      <Button size="icon-xs" variant="ghost" onClick={() => setEdit(w)}><PencilIcon /></Button>
                      <Button size="icon-xs" variant="ghost" onClick={() => del(w)}><Trash2Icon /></Button>
                    </>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
      {edit && <WeldDialog w={edit} projectId={projectId} wps={wps} bom={bom} onClose={() => setEdit(null)} onSaved={r => { setEdit(null); load(); if (r?.problems?.length) showToast(r.problems.join('; '), 'error'); }} />}
    </Card>
  );
}

function WeldDialog({ w, projectId, wps, bom, onClose, onSaved }) {
  const [f, setF] = useState({ weld_no: w.weld_no || '', joint: w.joint || '', category: w.category || '', type: w.type || '', wps_id: w.wps_id ? String(w.wps_id) : '',
    welder_stamps: w.welder_stamps || '', nde: w.nde || '', part_a_bom_item_id: w.part_a_bom_item_id ? String(w.part_a_bom_item_id) : '',
    part_b_bom_item_id: w.part_b_bom_item_id ? String(w.part_b_bom_item_id) : '', welded_on: w.welded_on || '' });
  const [busy, setBusy] = useState(false);
  const bomOpts = [{ value: '', label: '—' }, ...bom.map(b => ({ value: String(b.id), label: `BM-${b.id} · ${b.material_description}${b.size_spec ? ` · ${b.size_spec}` : ''}` }))];
  async function save() {
    setBusy(true);
    try {
      const body = { ...f, project_id: projectId, wps_id: f.wps_id || null, part_a_bom_item_id: f.part_a_bom_item_id || null, part_b_bom_item_id: f.part_b_bom_item_id || null };
      const r = w.id ? await api(`/api/welds/${w.id}`, { method: 'PATCH', body }) : await api('/api/welds', { method: 'POST', body });
      onSaved(r);
    } catch (e) { showToast(e.message, 'error'); setBusy(false); }
  }
  const field = (k, l, ph) => <div className="flex flex-col gap-1"><Label>{l}</Label><Input value={f[k]} placeholder={ph} onChange={e => setF({ ...f, [k]: e.target.value })} /></div>;
  return (
    <Dialog open onOpenChange={v => !v && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader><DialogTitle>{w.id ? `Weld ${w.weld_no}` : 'New weld'}</DialogTitle></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-3">
          {field('weld_no', 'Weld no.', 'L1')}{field('joint', 'Joint', 'Shell long seam')}{field('category', 'Category', 'A')}
          {field('type', 'Type', 'Butt, double-welded')}
          <div className="flex flex-col gap-1"><Label>WPS</Label>
            <SearchableSelect value={f.wps_id} onChange={v => setF({ ...f, wps_id: v })} placeholder="Select…"
              options={[{ value: '', label: '—' }, ...wps.map(p => ({ value: String(p.id), label: `${p.wps_no} · ${p.process}${p.status === 'draft' ? ' (draft)' : ''}` }))]} /></div>
          <div className="flex flex-col gap-1"><Label>Welded on</Label><Input type="date" value={f.welded_on} onChange={e => setF({ ...f, welded_on: e.target.value })} /></div>
          {field('welder_stamps', 'Welder stamps', 'W-07, W-12')}{field('nde', 'NDE required', 'RT, VT')}<div />
          <div className="flex flex-col gap-1 sm:col-span-3"><Label>Part A (BOM line)</Label><SearchableSelect value={f.part_a_bom_item_id} onChange={v => setF({ ...f, part_a_bom_item_id: v })} options={bomOpts} placeholder="Select…" /></div>
          <div className="flex flex-col gap-1 sm:col-span-3"><Label>Part B (BOM line)</Label><SearchableSelect value={f.part_b_bom_item_id} onChange={v => setF({ ...f, part_b_bom_item_id: v })} options={bomOpts} placeholder="Select…" /></div>
        </div>
        <p className="text-xs text-muted-foreground">Saving with a date moves each welder’s last-weld date for the WPS process forward (continuity). A welder who is not qualified or has lapsed is listed as a warning.</p>
        <DialogFooter><Button disabled={busy} onClick={save}>Save weld</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function WpsList({ canEdit, canApprove }) {
  const [list, setList] = useState(null);
  const [edit, setEdit] = useState(null);
  const load = useCallback(() => api('/api/wps').then(setList).catch(e => showToast(e.message, 'error')), []);
  useEffect(() => { load(); }, [load]);
  async function upload(w, file) {
    const fd = new FormData(); fd.append('file', file);
    try { await api(`/api/wps/${w.id}/file`, { method: 'POST', body: fd }); showToast('WPS file uploaded'); load(); } catch (e) { showToast(e.message, 'error'); }
  }
  async function approve(w) {
    try { await api(`/api/wps/${w.id}/approve`, { method: 'POST' }); showToast(`${w.wps_no} approved`); load(); } catch (e) { showToast(e.message, 'error'); }
  }
  return (
    <Card>
      <CardHeader><CardTitle>Welding procedures (WPS)</CardTitle>
        {canEdit && <CardAction><Button size="sm" onClick={() => setEdit({})}><PlusIcon /> WPS</Button></CardAction>}</CardHeader>
      <CardContent>
        {!list ? <p className="text-sm text-muted-foreground">Loading…</p> : list.length === 0 ? <p className="text-sm text-muted-foreground">No WPS yet.</p> : (
          <table className="w-full text-xs">
            <thead><tr className="text-left text-muted-foreground"><th className="py-1.5">WPS</th><th>Process</th><th>PQR</th><th>Base metal</th><th>Thickness</th><th>PWHT</th><th>Status</th><th /></tr></thead>
            <tbody>{list.map(w => (
              <tr key={w.id} className="border-t">
                <td className="py-1.5 font-medium">{w.wps_no}{w.is_repair ? <Badge variant="outline" className="ml-1 px-1 py-0 text-[10px]">repair</Badge> : null}</td>
                <td>{w.process}</td><td>{w.pqr_no || '—'}</td><td>{w.base_metal || '—'}</td><td>{w.thickness || '—'}</td><td>{w.pwht || '—'}</td>
                <td className={w.status === 'approved' ? 'text-success' : 'text-warning'}>{w.status}{w.approved_by ? ` · ${w.approved_by}` : ''}</td>
                <td className="whitespace-nowrap text-right">
                  {w.has_pdf ? <a className="mr-2 text-primary underline" href={`/api/wps/${w.id}/file`} target="_blank" rel="noreferrer">PDF</a> : null}
                  {canEdit && w.status === 'draft' && <>
                    <label className="mr-1 inline-flex cursor-pointer items-center gap-1 text-primary"><UploadIcon className="size-3" />PDF
                      <input type="file" accept="application/pdf" className="hidden" onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) upload(w, f); }} /></label>
                    <Button size="icon-xs" variant="ghost" onClick={() => setEdit(w)}><PencilIcon /></Button>
                  </>}
                  {canApprove && w.status === 'draft' && <Button size="xs" variant="outline" disabled={!w.has_pdf} title={w.has_pdf ? '' : 'Upload the signed WPS first'} onClick={() => approve(w)}><CheckIcon /> Approve</Button>}
                </td>
              </tr>))}</tbody>
          </table>
        )}
      </CardContent>
      {edit && <SimpleForm title={edit.id ? `WPS ${edit.wps_no}` : 'New WPS'} init={edit}
        fields={[['wps_no', 'WPS no.', !!edit.id], ['process', 'Process (SMAW, GTAW…)'], ['pqr_no', 'PQR no.'], ['base_metal', 'Base metal (P-No.)'], ['thickness', 'Thickness range'], ['pwht', 'PWHT']]}
        checks={[['is_repair', 'Repair WPS']]}
        onClose={() => setEdit(null)}
        onSave={async f => { if (edit.id) await api(`/api/wps/${edit.id}`, { method: 'PATCH', body: f }); else await api('/api/wps', { method: 'POST', body: f }); setEdit(null); load(); }} />}
    </Card>
  );
}

function Welders({ canEdit }) {
  const [list, setList] = useState(null);
  const [edit, setEdit] = useState(null);
  const load = useCallback(() => api('/api/welders').then(setList).catch(e => showToast(e.message, 'error')), []);
  useEffect(() => { load(); }, [load]);
  async function uploadWpq(w, file) {
    const fd = new FormData(); fd.append('file', file);
    try { await api(`/api/welders/${w.id}/file`, { method: 'POST', body: fd }); showToast('WPQ uploaded'); load(); } catch (e) { showToast(e.message, 'error'); }
  }
  return (
    <Card>
      <CardHeader><CardTitle>Welders and continuity</CardTitle>
        {canEdit && <CardAction><Button size="sm" onClick={() => setEdit({})}><PlusIcon /> Welder</Button></CardAction>}</CardHeader>
      <CardContent>
        {!list ? <p className="text-sm text-muted-foreground">Loading…</p> : list.length === 0 ? <p className="text-sm text-muted-foreground">No welders yet.</p> : (
          <table className="w-full text-xs">
            <thead><tr className="text-left text-muted-foreground"><th className="py-1.5">Stamp</th><th>Name</th><th>WPQ</th><th>Process</th><th>Qualified</th><th>Last weld</th><th>Lapses</th><th>Status</th><th /></tr></thead>
            <tbody>{list.flatMap(w => (w.continuity.length ? w.continuity : [{ process: '—' }]).map((c, i) => (
              <tr key={`${w.id}-${i}`} className={`${i === 0 ? 'border-t' : ''} ${w.active ? '' : 'text-muted-foreground'}`}>
                <td className="py-1.5 font-medium">{i === 0 ? w.stamp : ''}</td><td>{i === 0 ? w.name : ''}</td><td>{i === 0 ? <>{w.wpq_no || '—'}
                  {w.wpq_pdf_key && <a className="ml-1 text-primary underline" href={`/api/welders/${w.id}/file`} target="_blank" rel="noreferrer">PDF</a>}
                  {canEdit && <label className="ml-1 inline-flex cursor-pointer items-center text-primary" title="Upload the WPQ PDF"><UploadIcon className="size-3" />
                    <input type="file" accept="application/pdf" className="hidden" onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) uploadWpq(w, f); }} /></label>}
                </> : ''}</td>
                <td>{c.process}</td><td>{c.qualified_on ? formatDate(c.qualified_on) : '—'}</td><td>{c.last_weld ? formatDate(c.last_weld) : '—'}</td>
                <td>{c.lapse ? formatDate(c.lapse) : '—'}</td>
                <td className={c.status === 'Current' ? 'text-success' : c.status ? 'text-danger' : ''}>{c.status || ''}</td>
                <td className="text-right">{i === 0 && canEdit && <Button size="icon-xs" variant="ghost" onClick={() => setEdit(w)}><PencilIcon /></Button>}</td>
              </tr>)))}</tbody>
          </table>
        )}
        <p className="mt-2 text-xs text-muted-foreground">Continuity: a welder’s qualification for a process lapses after six months without welding with it (QW-322.1). The clause text needs review against your licensed copy.</p>
      </CardContent>
      {edit && <WelderDialog w={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
    </Card>
  );
}

function WelderDialog({ w, onClose, onSaved }) {
  const [f, setF] = useState({ stamp: w.stamp || '', name: w.name || '', wpq_no: w.wpq_no || '', active: w.id ? !!w.active : true });
  const [procs, setProcs] = useState(Object.entries(w.processes || {}).map(([p, v]) => ({ p, ...v })).concat(w.id ? [] : [{ p: 'SMAW', qualified_on: '', last_weld: '' }]));
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    const processes = Object.fromEntries(procs.filter(x => x.p.trim()).map(x => [x.p.trim().toUpperCase(), { qualified_on: x.qualified_on || null, last_weld: x.last_weld || null }]));
    try {
      if (w.id) await api(`/api/welders/${w.id}`, { method: 'PATCH', body: { name: f.name, wpq_no: f.wpq_no, active: f.active, processes } });
      else await api('/api/welders', { method: 'POST', body: { ...f, processes } });
      onSaved();
    } catch (e) { showToast(e.message, 'error'); setBusy(false); }
  }
  return (
    <Dialog open onOpenChange={v => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>{w.id ? `Welder ${w.stamp}` : 'New welder'}</DialogTitle></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="flex flex-col gap-1"><Label>Stamp</Label><Input value={f.stamp} disabled={!!w.id} onChange={e => setF({ ...f, stamp: e.target.value })} /></div>
          <div className="flex flex-col gap-1 sm:col-span-2"><Label>Name</Label><Input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></div>
          <div className="flex flex-col gap-1 sm:col-span-2"><Label>WPQ no.</Label><Input value={f.wpq_no} onChange={e => setF({ ...f, wpq_no: e.target.value })} /></div>
          {w.id && <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" checked={f.active} onChange={e => setF({ ...f, active: e.target.checked })} /> Active</label>}
        </div>
        <Label>Processes</Label>
        {procs.map((x, i) => (
          <div key={i} className="grid grid-cols-[90px_1fr_1fr_auto] items-end gap-2">
            <Input value={x.p} placeholder="SMAW" onChange={e => setProcs(ps => ps.map((y, j) => (j === i ? { ...y, p: e.target.value } : y)))} />
            <div className="flex flex-col gap-1"><span className="text-xs text-muted-foreground">Qualified on</span><Input type="date" value={x.qualified_on || ''} onChange={e => setProcs(ps => ps.map((y, j) => (j === i ? { ...y, qualified_on: e.target.value } : y)))} /></div>
            <div className="flex flex-col gap-1"><span className="text-xs text-muted-foreground">Last weld</span><Input type="date" value={x.last_weld || ''} onChange={e => setProcs(ps => ps.map((y, j) => (j === i ? { ...y, last_weld: e.target.value } : y)))} /></div>
            <Button size="icon-sm" variant="ghost" onClick={() => setProcs(ps => ps.filter((_, j) => j !== i))}><Trash2Icon /></Button>
          </div>
        ))}
        <Button size="xs" variant="ghost" className="self-start" onClick={() => setProcs(ps => [...ps, { p: '', qualified_on: '', last_weld: '' }])}><PlusIcon /> Process</Button>
        <DialogFooter><Button disabled={busy} onClick={save}>Save</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function SimpleForm({ title, init, fields, checks = [], onClose, onSave }) {
  const [f, setF] = useState(Object.fromEntries([...fields.map(([k]) => [k, init[k] ?? '']), ...checks.map(([k]) => [k, !!init[k]])]));
  const [busy, setBusy] = useState(false);
  async function save() { setBusy(true); try { await onSave(f); } catch (e) { showToast(e.message, 'error'); setBusy(false); } }
  return (
    <Dialog open onOpenChange={v => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          {fields.map(([k, l, disabled]) => <div key={k} className="flex flex-col gap-1"><Label>{l}</Label><Input value={f[k]} disabled={disabled} onChange={e => setF({ ...f, [k]: e.target.value })} /></div>)}
          {checks.map(([k, l]) => <label key={k} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f[k]} onChange={e => setF({ ...f, [k]: e.target.checked })} /> {l}</label>)}
        </div>
        <DialogFooter><Button disabled={busy} onClick={save}>Save</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
