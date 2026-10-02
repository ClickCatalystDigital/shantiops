'use client';

// Remnants — the physical leftover of a cut, in two small screens that share one row look.
//   RemnantsProduction (Production → Remnants): "To cut" (pieces reserved for jobs, click Cut — the
//   PMB size is pre-filled) and "Returned, waiting for Stores" (remnants carried back; Scrap it if
//   unusable).
//   RemnantsQueue (Stores → Inward → Remnants): one click to Confirm a remnant into common stock, or
//   Scrap it. Both read GET /api/stock-pieces?status=…; every rule (CAS, ownership, cost) lives in
//   lib/stock-pieces.js, not here.
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, showToast } from '@/lib/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ScissorsIcon, CheckIcon, Trash2Icon, Undo2Icon } from 'lucide-react';
import CutDialog, { pieceDimsLabel } from '@/components/CutDialog';
import StoresSubTabs from '@/components/StoresSubTabs';
import ProjectMultiFilter from '@/components/ProjectMultiFilter';

function ageLabel(createdAt) {
  if (!createdAt) return '';
  const days = Math.floor((Date.now() - new Date(String(createdAt).replace(' ', 'T') + 'Z').getTime()) / 86400000);
  return days <= 0 ? 'today' : days === 1 ? '1 day' : `${days} days`;
}

function usePieces(status) {
  const [rows, setRows] = useState(null);
  const reload = useCallback(() => api(`/api/stock-pieces?status=${status}`).then(setRows).catch(e => { showToast(e.message, 'error'); setRows([]); }), [status]);
  useEffect(() => { reload(); }, [reload]);
  return [rows, reload];
}

function Empty({ icon: Icon, children }) {
  return (
    <div className="flex flex-col items-center gap-2 py-10 text-center text-sm text-muted-foreground">
      <Icon className="size-6 opacity-40" />{children}
    </div>
  );
}

function PieceInfo({ p, extra }) {
  const trace = [p.heat_no, p.certificate_no].filter(Boolean).join(' · ');
  return (
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium tnum">{p.code}</span>
        <span className="truncate text-muted-foreground">{p.item_description}</span>
      </div>
      <div className="mt-0.5 text-xs text-muted-foreground">{[extra, trace].filter(Boolean).join(' · ')}</div>
    </div>
  );
}

function Dims({ p }) {
  return (
    <div className="text-right text-sm tnum">
      <div>{pieceDimsLabel(p)}</div>
      <div className="text-xs text-muted-foreground">{p.weight_kg} kg</div>
    </div>
  );
}

async function scrap(p, reload) {
  if (!confirm(`Scrap ${p.code}? It will be written off and can't be reused.`)) return;
  try { await api(`/api/stock-pieces/${p.id}/scrap`, { method: 'POST', body: {} }); showToast('Scrapped'); await reload(); }
  catch (e) { showToast(e.message, 'error'); }
}

export function RemnantsProduction({ projects = [] }) {
  const router = useRouter();
  const [toCut, reloadCut] = usePieces('reserved');
  const [returned, reloadReturned] = usePieces('pending_receipt');
  const [cutting, setCutting] = useState(null);
  const [sub, setSub] = useState('cut');
  const [picked, setPicked] = useState(new Set());
  const reloadAll = () => Promise.all([reloadCut(), reloadReturned()]);

  // A piece belongs to the project it is reserved for, else the indent's project, else its owner.
  const projectOf = p => p.project_id || p.indent_project_id || p.owner_project_id || null;
  const keep = list => (list && picked.size ? list.filter(p => picked.has(projectOf(p))) : list);
  const cutRows = keep(toCut), returnedRows = keep(returned);
  const options = projects.map(pr => ({ id: pr.id, label: pr.project_no, sub: pr.customer_name }));

  const dialogProps = p => p.bom_item_id
    ? { bomItem: { id: p.bom_item_id, material_description: p.bom_description, category: p.bom_category,
        category_fields_json: p.bom_category_fields_json, named_parts_json: p.bom_named_parts_json } }
    : { initialSource: p, projectId: p.project_id || p.indent_project_id || undefined };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <StoresSubTabs value={sub} onChange={setSub} tabs={[
          { value: 'cut', label: 'Cut', count: cutRows?.length || 0 },
          { value: 'returns', label: 'Returns to Stores', count: returnedRows?.length || 0 },
        ]} />
        <ProjectMultiFilter options={options} value={picked} onChange={setPicked} />
      </div>

      {sub === 'cut' && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><ScissorsIcon className="size-4" />To cut</CardTitle>
            <CardDescription>Pieces Stores has reserved for a job. Click Cut — the size from the PMB is filled in; you only enter the remnant you keep.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col divide-y">
            {cutRows === null ? <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>
              : cutRows.length === 0 ? <Empty icon={ScissorsIcon}>{picked.size ? 'Nothing to cut for these projects.' : 'Nothing waiting to be cut.'}</Empty>
              : cutRows.map(p => (
                <div key={p.id} className="flex flex-wrap items-center gap-4 py-3">
                  <PieceInfo p={p} extra={p.project_no ? `${p.project_no} · ${p.bom_description || ''}` : p.indent_no ? `Indent ${p.indent_no}` : ''} />
                  <Dims p={p} />
                  <Button size="sm" onClick={() => setCutting(p)}><ScissorsIcon />Cut</Button>
                </div>
              ))}
          </CardContent>
        </Card>
      )}

      {sub === 'returns' && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Undo2Icon className="size-4" />Returns to Stores</CardTitle>
            <CardDescription>Remnants you carried back. Stores confirms them into stock. If one is unusable, Scrap it.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col divide-y">
            {returnedRows === null ? <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>
              : returnedRows.length === 0 ? <Empty icon={CheckIcon}>{picked.size ? 'Nothing waiting for these projects.' : 'Nothing waiting for Stores.'}</Empty>
              : returnedRows.map(p => (
                <div key={p.id} className="flex flex-wrap items-center gap-4 py-3">
                  <PieceInfo p={p} extra={`cut from ${p.parent_code || '—'} · ${ageLabel(p.created_at)}`} />
                  <Dims p={p} />
                  <Button size="sm" variant="outline" onClick={() => scrap(p, reloadAll)}><Trash2Icon />Scrap it</Button>
                </div>
              ))}
          </CardContent>
        </Card>
      )}

      {cutting && <CutDialog {...dialogProps(cutting)} router={router} onClose={() => setCutting(null)} onDone={reloadAll} />}
    </div>
  );
}

export function RemnantsQueue({ onCount }) {
  const router = useRouter();
  const [rows, reload] = usePieces('pending_receipt');
  const [picked, setPicked] = useState(new Set());
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (rows) onCount?.(rows.length); }, [rows, onCount]);

  const toggle = id => setPicked(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  async function confirmIds(ids) {
    setBusy(true);
    let done = 0;
    for (const id of ids) {
      try { await api(`/api/stock-pieces/${id}/confirm-receipt`, { method: 'POST', body: {} }); done++; }
      catch (e) { showToast(e.message, 'error'); }
    }
    if (done) showToast(done === 1 ? 'Confirmed — now in stock' : `${done} remnants confirmed — now in stock`);
    setPicked(new Set()); await reload(); router.refresh(); setBusy(false);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Remnants from Production</CardTitle>
        <CardDescription>Production carried these back from the shop floor. Confirm each one you have physically received — it joins common stock and can be used for any project or order.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col">
        {rows === null ? <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>
          : rows.length === 0 ? <Empty icon={CheckIcon}>No remnants waiting. You're all caught up.</Empty>
          : (
            <>
              <div className="mb-2 flex items-center justify-between gap-2 border-b pb-3">
                <label className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Checkbox checked={picked.size === rows.length} onCheckedChange={c => setPicked(c ? new Set(rows.map(r => r.id)) : new Set())} />
                  Select all
                </label>
                <Button size="sm" disabled={busy || picked.size === 0} onClick={() => confirmIds([...picked])}>
                  <CheckIcon />Confirm selected{picked.size ? ` (${picked.size})` : ''}
                </Button>
              </div>
              <div className="flex flex-col divide-y">
                {rows.map(p => (
                  <div key={p.id} className="flex flex-wrap items-center gap-4 py-3">
                    <Checkbox checked={picked.has(p.id)} onCheckedChange={() => toggle(p.id)} />
                    <PieceInfo p={p} extra={`cut from ${p.parent_code || '—'} · ${ageLabel(p.created_at)}`} />
                    <Dims p={p} />
                    <div className="flex gap-1.5">
                      <Button size="sm" disabled={busy} onClick={() => confirmIds([p.id])}><CheckIcon />Confirm</Button>
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => scrap(p, async () => { await reload(); router.refresh(); })}><Trash2Icon />Scrap it</Button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
      </CardContent>
    </Card>
  );
}
