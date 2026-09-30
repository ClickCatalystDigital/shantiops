'use client';

// Planning -> Material Plan. One row per BOM line: what's needed, what is already secured, what stock /
// remnants could cover it, what is on order and when, what is still short — and the next step.
// Read-only engine (lib/plan-coverage.js); every action calls an EXISTING route. A viewer who lacks
// the owning department's permission gets "Ask <dept>" instead, which raises the existing
// cross-department task (POST /api/production/tasks) — the Plan never crosses a department gate.
import { useEffect, useMemo, useState } from 'react';
import { api, showToast, formatDate } from '@/lib/client';
import { todayISO } from '@/lib/date';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import SearchableSelect from '@/components/SearchableSelect';
import { PLAN_STATUS } from '@/lib/plan-coverage.mjs';
import { RefreshCwIcon, ChevronRightIcon, ChevronDownIcon, AlertTriangleIcon } from 'lucide-react';

const TONE = {
  success: 'bg-success/15 text-success', info: 'bg-primary/10 text-primary',
  warning: 'bg-warning/15 text-warning', danger: 'bg-danger/15 text-danger',
};
const ATTENTION = ['decision', 'sourcing', 'late', 'held_qc'];
const FILTERS = [
  { key: 'attention', label: 'Needs attention', match: r => ATTENTION.includes(r.status) },
  { key: 'short', label: 'Shortfall', match: r => r.short > 0 },
  { key: 'unreleased', label: 'BOM not released', match: r => r.status === 'unreleased' },
  { key: 'on_order', label: 'On order', match: r => r.status === 'on_order' || r.status === 'late' },
  { key: 'covered', label: 'Covered', match: r => ['covered', 'in_hand'].includes(r.status) },
  { key: 'all', label: 'All', match: () => true },
];
const n = v => (Math.round((Number(v) || 0) * 100) / 100).toString();

function StatusBadge({ status }) {
  const s = PLAN_STATUS[status] || { label: status, tone: 'info' };
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${TONE[s.tone]}`}>{s.label}</span>;
}

export default function PlanTab({ canReserve, canProcure, fromDept, initialProject }) {
  const [data, setData] = useState(null);
  const [filter, setFilter] = useState('attention');
  const [project, setProject] = useState(initialProject || '');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(() => new Set());
  const [busy, setBusy] = useState(null);

  async function load() {
    setData(null);
    try { setData(await api('/api/plan')); } catch (e) { showToast(e.message, 'error'); setData({ rows: [], counts: {}, items: {} }); }
  }
  useEffect(() => { load(); }, []);

  const rows = data?.rows || [];
  const projects = useMemo(() => {
    const m = new Map();
    rows.forEach(r => m.set(String(r.project_id), r.project_label));
    return [{ value: '', label: 'All projects' }, ...[...m].map(([value, label]) => ({ value, label }))];
  }, [rows]);

  const shown = useMemo(() => {
    const f = FILTERS.find(x => x.key === filter);
    const term = q.trim().toLowerCase();
    return rows.filter(r => f.match(r)
      && (!project || String(r.project_id) === project)
      && (!term || `${r.description} ${r.moc || ''} ${r.size_spec || ''} ${r.project_label}`.toLowerCase().includes(term)));
  }, [rows, filter, project, q]);

  const grouped = useMemo(() => {
    const m = new Map();
    for (const r of shown) {
      const k = `${r.project_id}`;
      if (!m.has(k)) m.set(k, { label: r.project_label, customer: r.customer_name, rows: [] });
      m.get(k).rows.push(r);
    }
    // earliest need-by first so the most urgent project reads first
    return [...m.values()].sort((a, b) => (a.rows[0].needBy || '9').localeCompare(b.rows[0].needBy || '9'));
  }, [shown]);

  const kpi = key => rows.filter(FILTERS.find(f => f.key === key).match).length;

  async function ask(r, dept, why) {
    await api('/api/production/tasks', {
      method: 'POST',
      body: {
        department: dept, from_department: fromDept, project_id: r.project_id || undefined,
        title: `Plan: ${why} — ${r.description}`.slice(0, 140),
        body: `${r.project_label} · needed ${r.needBy ? formatDate(r.needBy) : 'date not set'} · ${r.short > 0 ? `short ${n(r.short)}` : `arriving ${r.incoming_date ? formatDate(r.incoming_date) : 'date not set'}`} · ${PLAN_STATUS[r.status]?.label}`,
        due_date: todayISO(),
      },
    });
    showToast(`Asked ${dept}`);
  }

  async function act(r) {
    setBusy(r.id);
    try {
      if (r.action === 'reserve') {
        if (!canReserve) await ask(r, 'Stores', r.remnant ? 'reserve remnant piece' : 'reserve stock');
        else if (r.remnant && r.remnant_piece_id) {
          await api(`/api/stock-pieces/${r.remnant_piece_id}/reserve`, { method: 'POST', body: { project_id: r.project_id, bom_item_id: r.id } });
          showToast(`Reserved ${r.remnant_piece_code}`); await load();
        } else {
          await api(`/api/inventory-items/${r.inventory_item_id}/reserve`, { method: 'POST', body: { bom_item_id: r.id, qty: r.free } });
          showToast('Reserved from stock'); await load();
        }
      } else if (r.action === 'decide') {
        if (canProcure) { await api(`/api/bom-items/${r.id}/procure`, { method: 'POST' }); showToast('Sent to Procurement'); await load(); }
        else await ask(r, 'Stores', 'reserve from stock or send to Procurement');
      } else if (r.action === 'chase_procurement') await ask(r, 'Procurement', 'sourcing is holding this up');
      else if (r.action === 'expedite') await ask(r, 'Procurement', 'delivery is after the need-by date');
      else if (r.action === 'chase_qc') await ask(r, 'QC', 'received material is waiting on inward QC');
    } catch (e) { showToast(e.message, 'error'); }
    setBusy(null);
  }

  function actionLabel(r) {
    const direct = { reserve: canReserve, decide: canProcure }[r.action];
    const base = { reserve: r.remnant ? 'Reserve piece' : 'Reserve', decide: 'Send to Procurement', chase_procurement: 'Chase', expedite: 'Expedite', chase_qc: 'Chase QC' }[r.action];
    if (!base) return null;
    return ['chase_procurement', 'expedite', 'chase_qc'].includes(r.action) || direct ? base : `Ask Stores`;
  }

  if (!data) return <p className="py-10 text-center text-sm text-muted-foreground">Working out coverage…</p>;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map(f => (
          <button key={f.key} onClick={() => setFilter(f.key)}
            className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${filter === f.key ? 'border-primary bg-primary/10 font-medium' : 'hover:bg-muted'}`}>
            {f.label} <span className="tnum text-muted-foreground">{kpi(f.key)}</span>
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          <SearchableSelect className="w-52" value={project} onChange={setProject} options={projects}
            displayValue={projects.find(p => p.value === project)?.label} placeholder="All projects" />
          <Input className="w-44" placeholder="Search material…" value={q} onChange={e => setQ(e.target.value)} />
          <Button size="icon" variant="outline" onClick={load} title="Refresh"><RefreshCwIcon /></Button>
        </div>
      </div>

      {grouped.length === 0 && (
        <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">
          {rows.length === 0 ? 'No BOM demand on active projects yet.' : 'Nothing matches this filter.'}
        </CardContent></Card>
      )}

      {grouped.map(g => (
        <Card key={g.label}>
          <CardContent className="pt-4">
            <div className="mb-2 flex flex-wrap items-baseline gap-2">
              <h3 className="font-semibold">{g.label}</h3>
              {g.customer && <span className="text-sm text-muted-foreground">{g.customer}</span>}
              <span className="ml-auto text-xs text-muted-foreground">
                {g.rows[0].needBy ? `Production starts ${formatDate(g.rows[0].needBy)}` : 'No production date set'}
              </span>
            </div>
            <div className="divide-y text-sm">
              {g.rows.map(r => {
                const isOpen = open.has(r.id), label = actionLabel(r);
                return (
                  <div key={r.id} className="py-2">
                    <div className="flex flex-wrap items-center gap-3">
                      <button className="text-muted-foreground" onClick={() => setOpen(s => { const x = new Set(s); x.has(r.id) ? x.delete(r.id) : x.add(r.id); return x; })}>
                        {isOpen ? <ChevronDownIcon className="size-4" /> : <ChevronRightIcon className="size-4" />}
                      </button>
                      <div className="min-w-0 flex-1 basis-56">
                        <div className="font-medium">{r.description}</div>
                        <div className="text-xs text-muted-foreground">
                          {[r.group, r.moc, r.size_spec].filter(Boolean).join(' · ')}
                        </div>
                      </div>
                      <div className="tnum w-24 text-right">
                        <div>{r.required == null ? '—' : n(r.required)}</div>
                        <div className="text-xs text-muted-foreground">needed{r.ambiguous && <AlertTriangleIcon className="ml-1 inline size-3 text-warning" title="Quantity text has several numbers — check it" />}</div>
                      </div>
                      <div className="w-28">
                        <StatusBadge status={r.status} />
                        {r.urgent && <div className="mt-0.5 text-xs text-danger">Due soon</div>}
                      </div>
                      <div className="w-28 text-right">
                        {label && <Button size="sm" variant={r.status === 'decision' || r.status === 'late' ? 'default' : 'outline'} disabled={busy === r.id} onClick={() => act(r)}>{label}</Button>}
                      </div>
                    </div>
                    {isOpen && (
                      <div className="ml-7 mt-2 grid gap-x-6 gap-y-1 rounded-lg bg-muted/40 p-3 text-xs sm:grid-cols-3">
                        <div>Secured (received / reserved): <b className="tnum">{n(r.secured)}</b></div>
                        <div>Free stock{r.inventory_description ? ` (${r.inventory_description})` : ''}: <b className="tnum">{n(r.free)}</b></div>
                        <div>Matching remnants: <b className="tnum">{r.remnant}</b>{r.remnant_piece_code ? ` (${r.remnant_piece_code})` : ''}</div>
                        <div>On order: <b className="tnum">{n(r.incoming)}</b>{r.incoming > 0 && ` · ${r.incoming_date ? formatDate(r.incoming_date) : 'date not set'}`}</div>
                        <div>Held for QC: <b className="tnum">{n(r.held_qc)}</b></div>
                        <div>Still short: <b className="tnum">{n(r.short)}</b></div>
                        <div className="sm:col-span-3 text-muted-foreground">
                          Needed by {r.needBy ? formatDate(r.needBy) : 'not set'} · status {r.purchase_status}
                          {r.catalog_item_code ? ` · ${r.catalog_item_code}` : ''}{!r.inventory_item_id && r.required ? ' · not linked to stock, free stock can’t be matched' : ''}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
