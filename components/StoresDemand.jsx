'use client';

// Stores -> Demand. Project-first view of the Material Plan (lib/plan-coverage.*): one card per project
// whose production starts inside the chosen window, expand for the lines. There is NO second coverage
// calculation here — every number and state comes from /api/plan/projects and /api/plan, and every action
// calls an existing route (Reserve, Reserve remnant) or the new Raise-PR route. Rows owned by another
// department get "Ask <dept>" (existing cross-department task), same as Planning's Material Plan.
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ChevronDownIcon, ChevronRightIcon, PuzzleIcon, AlertTriangleIcon } from 'lucide-react';
import { api, showToast, formatDate } from '@/lib/client';
import { todayISO } from '@/lib/date';
import { PLAN_STATUS } from '@/lib/plan-coverage.mjs';
import { possibleMatches, ReserveDialog, MatchSettingsPopover, SearchBox } from '@/components/StoresShared';

const WINDOWS = [
  { value: '7', label: 'Next 7 days' }, { value: '14', label: 'Next 14 days' }, { value: '30', label: 'Next 30 days' },
  { value: '60', label: 'Next 60 days' }, { value: '90', label: 'Next 90 days' }, { value: '3650', label: 'Everything' },
];
const HEALTH = { red: 'bg-danger', yellow: 'bg-warning', green: 'bg-success', unreleased: 'bg-muted-foreground/40' };
const STATE = {
  covered: { label: 'Covered', cls: 'bg-success/15 text-success' },
  on_order: { label: 'On order', cls: 'bg-info/15 text-info' },
  needs_action: { label: 'Needs action', cls: 'bg-danger/15 text-danger' },
  unreleased: { label: 'BOM not released', cls: 'bg-muted text-muted-foreground' },
};
const n = v => (Math.round((Number(v) || 0) * 100) / 100).toString();

function StateBadge({ row }) {
  const d = row.demand, s = STATE[d.state];
  const reason = d.state === 'needs_action' || d.late ? PLAN_STATUS[row.status]?.label : null;
  return (
    <div className="flex flex-col items-start gap-0.5">
      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${s.cls}`}>{s.label}</span>
      {d.late && <span className="text-[10px] font-medium text-danger">Late</span>}
      {d.owner && <span className="text-[10px] text-muted-foreground">Owner: {d.owner}</span>}
      {reason && !d.late && <span className="text-[10px] text-muted-foreground">{reason}</span>}
    </div>
  );
}

function Counts({ s }) {
  const chips = [
    ['Needs action', s.needs_action, 'text-danger'], ['On order', s.on_order, 'text-info'],
    ['Covered', s.covered, 'text-success'],
  ];
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
      {chips.map(([label, v, cls]) => v > 0 && <span key={label}><b className={`tnum ${cls}`}>{v}</b> <span className="text-muted-foreground">{label}</span></span>)}
      {s.late > 0 && <span className="text-danger"><b className="tnum">{s.late}</b> late</span>}
      {s.unreleased > 0 && <span className="text-muted-foreground"><b className="tnum">{s.unreleased}</b> not released</span>}
    </div>
  );
}

function ProjectCard({ p, inventoryItems, fromDept, onChanged }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(null);
  const [reserveFor, setReserveFor] = useState(null);
  const reservable = useMemo(() => inventoryItems.filter(i => i.tracking_mode !== 'piece' && i.tracking_mode !== 'serial'), [inventoryItems]);

  async function load() {
    try { setRows((await api(`/api/plan?project_ids=${p.project_id}&hints=1&stage=1`)).rows); }
    catch (e) { showToast(e.message, 'error'); setRows([]); }
  }
  function toggle() { setOpen(o => !o); if (!rows) load(); }

  async function ask(r, dept, why) {
    await api('/api/production/tasks', {
      method: 'POST',
      body: {
        department: dept, from_department: fromDept, project_id: r.project_id || undefined,
        title: `Demand: ${why} — ${r.description}`.slice(0, 140),
        body: `${r.project_label} · needed ${r.needBy ? formatDate(r.needBy) : 'date not set'} · ${PLAN_STATUS[r.status]?.label}`,
        due_date: todayISO(),
      },
    });
    showToast(`Asked ${dept}`);
  }
  async function run(r, fn) {
    setBusy(r.id);
    try { await fn(); await load(); onChanged?.(); router.refresh(); } catch (e) { showToast(e.message, 'error'); }
    setBusy(null);
  }
  const reserveRemnant = r => run(r, async () => {
    await api(`/api/stock-pieces/${r.remnant_piece_id}/reserve`, { method: 'POST', body: { project_id: r.project_id, bom_item_id: r.id } });
    showToast(`Reserved ${r.remnant_piece_code}`);
  });
  const raisePr = r => run(r, async () => {
    const res = await api(`/api/bom-items/${r.id}/raise-pr`, { method: 'POST' });
    showToast(`${res.pr_no} raised — Procurement will see it in Enquiry`);
  });

  const shown = (rows || []).filter(r => r.demand.state !== 'unreleased' && r.source !== 'sas');
  // Attention first, then the rest, so the open question is at the top of an expanded card.
  const order = { needs_action: 0, on_order: 1, covered: 2 };
  shown.sort((a, b) => order[a.demand.state] - order[b.demand.state] || a.id - b.id);

  return (
    <Card>
      <CardHeader className="cursor-pointer" onClick={toggle}>
        <div className="flex flex-wrap items-center gap-3">
          {open ? <ChevronDownIcon className="size-4" /> : <ChevronRightIcon className="size-4" />}
          <span className={`size-2.5 rounded-full ${HEALTH[p.health]}`} title={p.health} />
          <CardTitle className="text-base">{p.project_label}</CardTitle>
          {p.customer_name && <span className="text-sm text-muted-foreground">{p.customer_name}</span>}
          <span className="ml-auto text-xs text-muted-foreground">
            {p.needBy ? `Production starts ${formatDate(p.needBy)}` : p.is_stock ? 'No project date' : 'No start date'}
          </span>
        </div>
        <Counts s={p} />
      </CardHeader>
      {open && (
        <CardContent className="pt-0">
          {rows === null ? <p className="py-4 text-sm text-muted-foreground">Loading…</p>
            : shown.length === 0 ? <p className="py-4 text-sm text-muted-foreground">Nothing to show.{p.unreleased > 0 && ` ${p.unreleased} line(s) wait for the BOM to be released.`}</p>
            : (
              <div className="divide-y text-sm">
                {shown.map(r => {
                  const matches = r.demand.owner === 'Stores' ? possibleMatches(r, reservable) : [];
                  const canReserveNow = r.demand.owner === 'Stores' && (r.free > 0 || r.remnant > 0 || matches.length > 0);
                  const canRaise = r.status === 'decision' && !r.free && !r.remnant && !r.pr_item_id && r.source === 'bom';
                  return (
                    <div key={r.id} className={`flex flex-wrap items-center gap-3 py-2.5 ${r.demand.state === 'needs_action' ? 'border-l-2 border-l-warning pl-2' : ''}`}>
                      <div className="min-w-0 flex-1 basis-56">
                        <div className="font-medium">{r.description}{r.source === 'stock' && <Badge variant="outline" className="ml-2 border-dashed text-[10px]">Build Stock</Badge>}</div>
                        <div className="text-xs text-muted-foreground">{[r.group, r.moc, r.size_spec].filter(Boolean).join(' · ')}</div>
                        {matches.length > 0 && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {matches.map(({ item, exact }) => (
                              <Badge key={item.id} variant="outline"
                                className={exact ? 'border-success/30 bg-success-surface text-[10px] font-normal text-success' : 'text-[10px] font-normal text-muted-foreground'}
                                title={exact ? 'Same catalog item — a real match.' : 'Non-binding keyword overlap — confirm before reserving.'}>
                                {exact ? '✓' : '≈'} {item.item_code ? `${item.item_code} · ` : ''}{item.description} ({item.available} avail)
                              </Badge>
                            ))}
                          </div>
                        )}
                        {r.combinable_piece_count > 0 && (
                          <p className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground">
                            <PuzzleIcon className="size-3" />{r.combinable_piece_count} matching piece(s) in stock, too small alone — manual review
                          </p>
                        )}
                      </div>
                      <div className="tnum w-20 text-right">
                        <div>{r.required == null ? '—' : n(r.required)}</div>
                        <div className="text-xs text-muted-foreground">needed{r.ambiguous && <AlertTriangleIcon className="ml-1 inline size-3 text-warning" title="Quantity text has several numbers — check it" />}</div>
                      </div>
                      <div className="w-32">
                        <StateBadge row={r} />
                        {r.stage && <Badge variant="outline" className="mt-1 text-[10px] font-normal" title="Where the material is now">{r.stage.label}</Badge>}
                      </div>
                      <div className="w-44 text-xs text-muted-foreground tnum">
                        <div>In hand/reserved: <b className="text-foreground">{n(r.secured)}</b></div>
                        {(r.free > 0 || r.remnant > 0) && <div>Stock free: <b className="text-foreground">{r.remnant > 0 ? `${r.remnant} piece(s)` : n(r.free)}</b></div>}
                        {r.incoming > 0 && <div>On order: <b className="text-foreground">{n(r.incoming)}</b> · {r.incoming_date ? formatDate(r.incoming_date) : 'no date'}</div>}
                        {r.short > 0 && <div className="text-danger">Short: <b>{n(r.short)}</b></div>}
                      </div>
                      <div className="flex w-44 flex-wrap justify-end gap-1.5">
                        {canReserveNow && (r.remnant > 0 && r.remnant_piece_id && !r.free
                          ? <Button size="sm" disabled={busy === r.id} onClick={() => reserveRemnant(r)}>Reserve piece</Button>
                          : <Button size="sm" disabled={busy === r.id} onClick={() => setReserveFor(r)}>Reserve</Button>)}
                        {canRaise && <Button size="sm" variant="outline" disabled={busy === r.id} onClick={() => raisePr(r)}>Raise PR</Button>}
                        {r.demand.owner === 'Procurement' && <Button size="sm" variant="outline" disabled={busy === r.id} onClick={() => run(r, () => ask(r, 'Procurement', 'sourcing is holding this up'))}>Ask Procurement</Button>}
                        {r.demand.late && <Button size="sm" variant="outline" disabled={busy === r.id} onClick={() => run(r, () => ask(r, 'Procurement', 'delivery is after the need-by date'))}>Ask Procurement</Button>}
                        {r.source === 'bom' && r.demand.owner === 'Procurement' && r.status === 'sourcing' && !r.pr_item_id && r.purchase_status === 'Enquiry' && !r.incoming && (
                          <Button size="sm" variant="ghost" disabled={busy === r.id} title="Return this line to Stores review (only while Procurement hasn't started on it)"
                            onClick={() => run(r, async () => { await api(`/api/bom-items/${r.id}/unprocure`, { method: 'POST' }); showToast('Taken back from Procurement'); })}>Take back</Button>
                        )}
                        {r.source === 'stock' && ['Enquiry', 'Comparison'].includes(r.purchase_status) && (
                          <Button size="sm" variant="ghost" disabled={busy === r.id}
                            onClick={() => window.confirm('Withdraw this stock request?') && run(r, async () => { await api(`/api/bom-items/${r.id}/withdraw`, { method: 'POST' }); showToast('Request withdrawn'); })}>Withdraw</Button>
                        )}
                        {r.source === 'bom' && r.demand.state === 'needs_action' && (
                          <Button size="sm" variant="ghost" disabled={busy === r.id} title="Project BOM lines belong to Engineering — ask them to cancel it"
                            onClick={() => run(r, () => ask(r, 'Engineering', 'please cancel this line'))}>Ask Eng. to cancel</Button>
                        )}
                        {r.demand.owner === 'QC' && <Button size="sm" variant="outline" disabled={busy === r.id} onClick={() => run(r, () => ask(r, 'QC', 'received material is waiting on inward QC'))}>Ask QC</Button>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
        </CardContent>
      )}
      {reserveFor && (
        <ReserveDialog request={reserveFor} inventoryItems={reservable} matches={possibleMatches(reserveFor, reservable)}
          router={{ refresh: () => { load(); onChanged?.(); router.refresh(); } }}
          defaultQty={reserveFor.free > 0 ? Math.min(reserveFor.free, Math.max(0, reserveFor.required - reserveFor.secured)) : undefined}
          onClose={() => setReserveFor(null)} />
      )}
    </Card>
  );
}

export default function StoresDemand({ inventoryItems }) {
  const router = useRouter();
  const [within, setWithin] = useState('14');
  const [q, setQ] = useState('');
  const [data, setData] = useState(null);
  const [showNoDate, setShowNoDate] = useState(false);

  // silent = refresh the card totals after an action without blanking the list.
  function fetchSummaries(silent) {
    if (!silent) setData(null);
    return api(`/api/plan/projects?within=${within}`).then(d => setData(d))
      .catch(e => { showToast(e.message, 'error'); setData(prev => prev || { projects: [] }); });
  }
  useEffect(() => { fetchSummaries(false); }, [within]); // eslint-disable-line react-hooks/exhaustive-deps

  const dated = (data?.projects || []).filter(p => p.group === 'window');
  const undated = (data?.projects || []).filter(p => p.group === 'nodate');
  const needle = q.trim().toLowerCase();
  const match = p => !needle || `${p.project_label} ${p.customer_name || ''}`.toLowerCase().includes(needle);

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Demand</CardTitle>
          <p className="text-sm text-muted-foreground">What each project needs from Stores — covered, on order, or waiting for someone to act. Only released BOM lines are listed.</p>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          <SearchBox className="min-w-[16rem] flex-1" value={q} onChange={setQ} placeholder="Search project or customer…" />
          <Select value={within} onValueChange={setWithin}>
            <SelectTrigger className="h-9 w-44"><SelectValue /></SelectTrigger>
            <SelectContent>{WINDOWS.map(w => <SelectItem key={w.value} value={w.value}>{w.label}</SelectItem>)}</SelectContent>
          </Select>
          <MatchSettingsPopover router={router} />
        </CardContent>
      </Card>

      {data === null ? <p className="py-8 text-center text-sm text-muted-foreground">Working out coverage…</p>
        : dated.length === 0 && undated.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">No projects start in this window.</p>
        : (
          <>
            {dated.filter(match).map(p => <ProjectCard key={p.project_id} p={p} inventoryItems={inventoryItems} fromDept="Stores" onChanged={() => fetchSummaries(true)} />)}
            {undated.length > 0 && (
              <>
                <button type="button" className="flex items-center gap-2 self-start text-sm text-muted-foreground underline" onClick={() => setShowNoDate(v => !v)}>
                  {showNoDate ? <ChevronDownIcon className="size-4" /> : <ChevronRightIcon className="size-4" />}
                  No start date ({undated.length})
                </button>
                {showNoDate && undated.filter(match).map(p => <ProjectCard key={p.project_id} p={p} inventoryItems={inventoryItems} fromDept="Stores" onChanged={() => fetchSummaries(true)} />)}
              </>
            )}
          </>
        )}
    </div>
  );
}
