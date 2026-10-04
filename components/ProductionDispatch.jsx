'use client';

// Shop Floor > Dispatch — Production hands FINISHED SUBSYSTEMS to Dispatch (first level of the BOM
// tree under the root: Feed Line, Shell & Body…), not single lines. Tick the subsystems that are
// done, hand over; every made-in-house line in them goes across in full. Dispatch is alerted and sees
// the items as ready to pack. Backed by /api/production/handovers (one record per line/unit, so
// quantities stay exact). Replaces the old Prod. Done tick on the project BOM table.
import { useEffect, useMemo, useState } from 'react';
import { api, showToast, formatDate } from '@/lib/client';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import ProjectMultiFilter from '@/components/ProjectMultiFilter';
import StoresSubTabs from '@/components/StoresSubTabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { ChevronDownIcon, ChevronRightIcon, SearchIcon, TruckIcon, UndoIcon, AlertTriangleIcon } from 'lucide-react';

const unitOf = qtyText => String(qtyText || '').replace(/^\s*[\d.]+\s*/, '').trim();
const subKey = l => `${l.indent_project_id}:${l.unit_project_id || 0}:${l.group_id || 0}`;

export default function ProductionDispatch() {
  const [data, setData] = useState(null);
  const [sub, setSub] = useState('todo');
  const [q, setQ] = useState('');
  const [projFilter, setProjFilter] = useState(new Set());
  const [picked, setPicked] = useState(new Set()); // subsystem keys
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [openSub, setOpenSub] = useState(new Set());
  const [ask, setAsk] = useState(null); // { items, groups, choices: {key: 'new'|listId}, approve: null|true|false }
  const [closedProj, setClosedProj] = useState(new Set()); // projects folded shut

  const load = () => api('/api/production/handovers').then(d => { setData(d); setPicked(new Set()); }).catch(e => showToast(e.message, 'error'));
  useEffect(() => { load(); }, []);

  const needle = q.trim().toLowerCase();
  const match = (...vals) => !needle || vals.some(v => String(v || '').toLowerCase().includes(needle));
  const inProj = id => !projFilter.size || projFilter.has(id);

  // Project options come from both tabs so the filter works on Handed over too.
  const options = useMemo(() => {
    const m = new Map();
    (data?.lines || []).forEach(l => m.set(l.indent_project_id, { id: l.indent_project_id, label: l.indent_project_no, sub: l.customer_name }));
    (data?.history || []).forEach(h => { if (!m.has(h.project_id)) m.set(h.project_id, { id: h.project_id, label: h.project_no }); });
    return [...m.values()];
  }, [data]);

  // Subsystems still to hand over: lines with something left (or an unclear quantity), grouped.
  const subsystems = useMemo(() => {
    const g = new Map();
    (data?.lines || []).forEach(l => {
      if (l.required_qty && l.remaining <= 0) return;
      const k = subKey(l);
      if (!g.has(k)) g.set(k, { key: k, project_id: l.indent_project_id, project_no: l.indent_project_no, customer: l.customer_name,
        unit: l.unit_project_no, group_id: l.group_id, name: l.group_name, lines: [] });
      g.get(k).lines.push(l);
    });
    return [...g.values()].map(s => ({
      ...s,
      ready: s.lines.filter(l => l.required_qty && l.remaining > 0),
      unclear: s.lines.filter(l => !l.required_qty).length,
      waiting: s.unit ? 0 : (data?.waiting?.[`${s.project_id}:${s.group_id || 0}`] || 0),
    }));
  }, [data]);
  const visible = subsystems.filter(s => inProj(s.project_id) && match(s.name, s.project_no, s.customer, s.unit, ...s.lines.map(l => l.material_description)));
  const byProject = useMemo(() => {
    const m = new Map();
    visible.forEach(s => {
      if (!m.has(s.project_id)) m.set(s.project_id, { id: s.project_id, no: s.project_no, customer: s.customer, subs: [] });
      m.get(s.project_id).subs.push(s);
    });
    return [...m.values()];
  }, [visible]);

  const toggle = k => setPicked(p => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const toggleOpen = k => setOpenSub(p => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const toggleProj = id => setClosedProj(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allClosed = byProject.length > 0 && byProject.every(p => closedProj.has(p.id));
  function collapseAll() {
    if (allClosed) { setClosedProj(new Set()); return; }
    setClosedProj(new Set(byProject.map(p => p.id)));
    setOpenSub(new Set());
  }
  const pickedSubs = subsystems.filter(s => picked.has(s.key) && s.ready.length);
  const readyCount = subsystems.filter(s => s.ready.length).length;

  // Step 1: ask the server what will happen to each project's packing list, then ask Production only
  // what matters — whether to pull a packed list back to draft, and (always) whether it approves.
  async function handOver() {
    const items = pickedSubs.flatMap(s => s.ready.map(l => ({
      bom_item_id: l.bom_item_id, child_project_id: l.unit_project_id || undefined, qty: l.remaining,
    })));
    setBusy(true);
    try {
      const { groups } = await api('/api/production/handovers/preview', { method: 'POST', body: { items } });
      const choices = {};
      groups.forEach(g => { if (g.reopenable) choices[g.key] = 'new'; });
      setAsk({ items, groups, choices, approve: null });
    } catch (err) { showToast(err.message, 'error'); }
    setBusy(false);
  }

  // Step 2: the answers are in — hand over.
  async function confirmHandOver() {
    setBusy(true);
    try {
      const list_choices = {};
      Object.entries(ask.choices).forEach(([k, v]) => { if (v !== 'new') list_choices[k] = v; });
      const r = await api('/api/production/handovers', { method: 'POST', body: { items: ask.items, note: note || undefined, approve: ask.approve, list_choices } });
      const lists = [...new Set((r.packing || []).filter(p => p.packing_no).map(p => p.packing_no))];
      const failed = (r.packing || []).filter(p => p.error);
      showToast(`${pickedSubs.length} subsystem${pickedSubs.length === 1 ? '' : 's'} handed over to Dispatch${lists.length ? ` — on packing list ${lists.length > 3 ? `${lists.slice(0, 3).join(', ')} +${lists.length - 3} more` : lists.join(', ')}` : ''}`);
      if (failed.length) showToast(`Handed over, but a packing list could not be updated (${failed[0].error}). Dispatch can add the items from Pending Items.`, 'error');
      setAsk(null);
      setNote('');
      await load();
    } catch (err) { showToast(err.message, 'error'); }
    setBusy(false);
  }

  // Handed over: one entry per subsystem handed over together (records made in one go share a second).
  const history = useMemo(() => {
    const g = new Map();
    (data?.history || []).forEach(h => {
      const k = `${h.project_id}:${h.child_project_id || 0}:${h.group_id || 0}:${h.handed_at}`;
      if (!g.has(k)) g.set(k, { key: k, project_id: h.project_id, project_no: h.project_no, unit: h.unit_project_no, name: h.group_name,
        at: h.handed_at, by: h.handed_by, note: h.note, rows: [] });
      g.get(k).rows.push(h);
    });
    return [...g.values()];
  }, [data]);

  async function undo(entry) {
    try {
      for (const h of entry.rows) await api(`/api/production/handovers/${h.id}`, { method: 'DELETE' });
    } catch (err) { showToast(err.message, 'error'); }
    await load();
  }

  if (!data) return <p className="text-sm text-muted-foreground">Loading…</p>;

  const histShown = history.filter(e => inProj(e.project_id) && match(e.name, e.project_no, e.unit, e.by, ...e.rows.map(r => r.material_description)));

  return (
    <div className="flex flex-col gap-3 pb-16">
      <StoresSubTabs value={sub} onChange={setSub} tabs={[
        { value: 'todo', label: 'To hand over', count: readyCount },
        { value: 'done', label: 'Handed over' },
      ]} />
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-52 flex-1">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search subsystem, item, project, unit…" className="h-9 pl-9" />
        </div>
        {sub === 'todo' && byProject.length > 0 && (
          <Button variant="outline" size="sm" onClick={collapseAll}>{allClosed ? 'Expand all' : 'Collapse all'}</Button>
        )}
        <ProjectMultiFilter options={options} value={projFilter} onChange={setProjFilter} />
      </div>

      {sub === 'todo' && !subsystems.length && (
        <div className="rounded-xl border border-dashed py-12 text-center text-sm text-muted-foreground">
          <TruckIcon className="mx-auto mb-2 size-6 opacity-40" />
          Nothing waiting. When Stores routes material to Production, its subsystem appears here; hand it over once the whole subsystem is finished.
        </div>
      )}
      {sub === 'todo' && subsystems.length > 0 && !byProject.length && <p className="rounded-xl border border-dashed py-10 text-center text-sm text-muted-foreground">No subsystems match.</p>}
      {sub === 'todo' && byProject.map(p => (
        <section key={p.id} className="overflow-hidden rounded-xl border bg-card">
          <button type="button" onClick={() => toggleProj(p.id)} className="flex w-full items-center gap-2 px-3 py-2.5 text-left">
            {closedProj.has(p.id) ? <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" /> : <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground" />}
            <span className="font-semibold">{p.no}</span>
            <span className="truncate text-sm text-muted-foreground">{p.customer}</span>
            <span className="ml-auto text-xs text-muted-foreground tnum">
              {p.subs.filter(s => picked.has(s.key)).length ? `${p.subs.filter(s => picked.has(s.key)).length} selected · ` : ''}{p.subs.length} subsystem{p.subs.length === 1 ? '' : 's'}
            </span>
          </button>
          {!closedProj.has(p.id) && <div className="divide-y border-t">
            {p.subs.map(s => {
              const open = openSub.has(s.key);
              const canPick = s.ready.length > 0;
              return (
                <div key={s.key} className="text-sm">
                  <div className="flex items-center gap-3 px-3 py-2.5">
                    <Checkbox checked={picked.has(s.key)} disabled={!canPick} onCheckedChange={() => toggle(s.key)} />
                    <button type="button" onClick={() => toggleOpen(s.key)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                      {open ? <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground" /> : <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />}
                      <span className="font-medium">{s.name}</span>
                      {s.unit && <Badge variant="outline" className="text-[10px]">Unit {s.unit}</Badge>}
                    </button>
                    <span className="shrink-0 text-xs text-muted-foreground tnum">{s.ready.length} item{s.ready.length === 1 ? '' : 's'}</span>
                  </div>
                  {(s.waiting > 0 || s.unclear > 0) && (
                    <div className="flex items-start gap-1.5 px-10 pb-2 text-xs text-warning">
                      <AlertTriangleIcon className="mt-0.5 size-3 shrink-0" />
                      <span>
                        {s.waiting > 0 && `${s.waiting} more made item${s.waiting === 1 ? '' : 's'} in this subsystem ${s.waiting === 1 ? 'is' : 'are'} not with Production yet (material not received or routed). `}
                        {s.unclear > 0 && `${s.unclear} item${s.unclear === 1 ? ' has' : 's have'} an unclear quantity and won't be handed over.`}
                      </span>
                    </div>
                  )}
                  {open && (
                    <div className="divide-y border-t bg-muted/20">
                      {s.lines.map(l => (
                        <div key={l.bom_item_id} className="flex flex-wrap items-center gap-x-3 px-10 py-1.5 text-xs">
                          <span className="font-medium">{l.material_description}</span>
                          {l.size_spec && <span className="text-muted-foreground">{l.size_spec}</span>}
                          <span className="ml-auto text-muted-foreground tnum">{l.required_qty ? `${l.remaining} ${unitOf(l.qty_text)}` : 'quantity unclear'}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>}
        </section>
      ))}

      {sub === 'done' && !histShown.length && <p className="rounded-xl border border-dashed py-10 text-center text-sm text-muted-foreground">{history.length ? 'No handovers match.' : 'Nothing handed over yet.'}</p>}
      {sub === 'done' && histShown.length > 0 && (
        <div className="divide-y overflow-hidden rounded-xl border bg-card">
          {histShown.map(e => (
            <div key={e.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
              <span className="font-medium">{e.name}</span>
              <span className="text-xs text-muted-foreground">{e.project_no}{e.unit ? ` · Unit ${e.unit}` : ''}</span>
              <span className="tnum text-xs">{e.rows.length} item{e.rows.length === 1 ? '' : 's'}</span>
              <span className="text-xs text-muted-foreground">{formatDate(e.at)} · {e.by}{e.note ? ` · ${e.note}` : ''}</span>
              <Button variant="ghost" size="sm" className="ml-auto h-7 gap-1 text-xs" onClick={() => undo(e)}><UndoIcon className="size-3" />Undo</Button>
            </div>
          ))}
        </div>
      )}

      <Dialog open={!!ask} onOpenChange={o => { if (!o && !busy) setAsk(null); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Hand over to Dispatch</DialogTitle>
            <DialogDescription>
              {pickedSubs.length} subsystem{pickedSubs.length === 1 ? '' : 's'} ({ask?.items.length} item{ask?.items.length === 1 ? '' : 's'}).
            </DialogDescription>
          </DialogHeader>
          {ask && (
            <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto">
              {ask.groups.filter(g => g.reopenable || g.blocked).map(g => (
                <fieldset key={g.key} className="flex flex-col gap-2 rounded-lg border p-3 text-sm">
                  <legend className="px-1 text-xs font-medium text-muted-foreground">{g.project_no}{g.unit ? ` · Unit ${g.unit}` : ''}</legend>
                  {g.reopenable ? (<>
                    <p>
                      Packing list <span className="font-medium">{g.reopenable.packing_no}</span> is already packed
                      {g.reopenable.review ? ' and in review' : ''}. Where should these {g.items} item{g.items === 1 ? '' : 's'} go?
                    </p>
                    <label className="flex items-start gap-2"><input type="radio" className="mt-1" checked={ask.choices[g.key] === 'new'}
                      onChange={() => setAsk(a => ({ ...a, choices: { ...a.choices, [g.key]: 'new' } }))} />
                      <span>Start a new draft list</span></label>
                    <label className="flex items-start gap-2"><input type="radio" className="mt-1" checked={ask.choices[g.key] === g.reopenable.id}
                      onChange={() => setAsk(a => ({ ...a, choices: { ...a.choices, [g.key]: g.reopenable.id } }))} />
                      <span>Add to {g.reopenable.packing_no}<span className="block text-xs text-muted-foreground">
                        It goes back to draft{g.reopenable.review ? ', its review is withdrawn and it has to be submitted again' : ''}.</span></span></label>
                  </>) : (
                    <p>{g.blocked.packing_no} is already packed and can't be reopened ({g.blocked.reason}). These items start a new draft list.</p>
                  )}
                </fieldset>
              ))}
              <fieldset className="flex flex-col gap-2 rounded-lg border p-3 text-sm">
                <legend className="px-1 text-xs font-medium text-muted-foreground">Production approval</legend>
                <p>Do you approve these items for dispatch?</p>
                <label className="flex items-start gap-2"><input type="radio" className="mt-1" name="ho-approve" checked={ask.approve === true}
                  onChange={() => setAsk(a => ({ ...a, approve: true }))} /><span>Yes, approved</span></label>
                <label className="flex items-start gap-2"><input type="radio" className="mt-1" name="ho-approve" checked={ask.approve === false}
                  onChange={() => setAsk(a => ({ ...a, approve: false }))} /><span>Not yet<span className="block text-xs text-muted-foreground">You can approve later from Approvals.</span></span></label>
              </fieldset>
            </div>
          )}
          <DialogFooter className="m-0">
            <Button variant="outline" disabled={busy} onClick={() => setAsk(null)}>Cancel</Button>
            <Button disabled={busy || ask?.approve === null} onClick={confirmHandOver}>{busy ? 'Handing over…' : 'Hand over'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {sub === 'todo' && pickedSubs.length > 0 && (
        <div className="sticky bottom-3 z-10 flex flex-wrap items-center gap-3 rounded-xl border bg-card px-4 py-2.5 shadow-lg">
          <span className="text-sm"><span className="font-semibold tnum">{pickedSubs.length}</span> subsystem{pickedSubs.length === 1 ? '' : 's'}</span>
          <Input value={note} onChange={e => setNote(e.target.value)} placeholder="Note for Dispatch (optional)" className="h-8 min-w-40 flex-1" />
          <Button variant="ghost" size="sm" onClick={() => setPicked(new Set())}>Clear</Button>
          <Button size="sm" disabled={busy} onClick={handOver}>{busy ? 'Checking…' : 'Hand over to Dispatch'}</Button>
        </div>
      )}
    </div>
  );
}
