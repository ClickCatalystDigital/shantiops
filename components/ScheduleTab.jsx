'use client';

// Planning -> Schedule: open Work Orders on a date axis, each with progress, a delayed flag and a
// material dot (from the same coverage engine as the Material Plan).
import { useEffect, useMemo, useState } from 'react';
import { api, showToast, formatDate } from '@/lib/client';
import { Card, CardContent } from '@/components/ui/card';

const DAY = 86400000;
const t = iso => new Date(iso + 'T00:00:00Z').getTime();
const MAT = { ready: ['bg-success', 'Material covered'], blocked: ['bg-danger', 'Material short or late'], unknown: ['bg-muted-foreground/40', 'No BOM demand found'], 'n/a': ['bg-muted-foreground/40', 'Stock Work Order'] };

export default function ScheduleTab() {
  const [d, setD] = useState(null);
  useEffect(() => { api('/api/plan/schedule').then(setD).catch(e => { showToast(e.message, 'error'); setD({ workOrders: [], today: '' }); }); }, []);

  const axis = useMemo(() => {
    if (!d) return null;
    const dates = d.workOrders.flatMap(w => [w.planned_start, w.planned_end]).filter(Boolean);
    const lo = Math.min(t(d.today) - 7 * DAY, ...dates.map(t));
    const hi = Math.max(t(d.today) + 28 * DAY, ...dates.map(t));
    return { lo, span: hi - lo, months: [] };
  }, [d]);
  if (!d) return <p className="py-10 text-center text-sm text-muted-foreground">Loading schedule…</p>;
  if (!d.workOrders.length) return <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">No released or in-progress Work Orders.</CardContent></Card>;

  const pct = iso => `${((t(iso) - axis.lo) / axis.span) * 100}%`;
  const todayLeft = pct(d.today);

  return (
    <Card><CardContent className="pt-4">
      <div className="mb-3 flex flex-wrap gap-4 text-xs text-muted-foreground">
        {Object.values(MAT).slice(0, 2).map(([c, l]) => <span key={l} className="flex items-center gap-1"><i className={`size-2 rounded-full ${c}`} />{l}</span>)}
        <span className="flex items-center gap-1"><i className="h-3 w-px bg-primary" />Today</span>
      </div>
      <div className="divide-y text-sm">
        {d.workOrders.map(w => {
          const [dot, dotLabel] = MAT[w.material];
          const s = w.planned_start || w.planned_end || d.today, e = w.planned_end || w.planned_start || d.today;
          const left = pct(s), width = `${Math.max(1.5, ((t(e) - t(s)) / axis.span) * 100)}%`;
          return (
            <div key={w.id} className="grid items-center gap-3 py-2 sm:grid-cols-[14rem_1fr]">
              <div className="min-w-0">
                <div className="flex items-center gap-2"><i className={`size-2 shrink-0 rounded-full ${dot}`} title={dotLabel} /><b>{w.wo_no}</b>
                  {w.delayed && <span className="rounded-full bg-danger/15 px-1.5 text-xs text-danger">Delayed</span>}</div>
                <div className="truncate text-xs text-muted-foreground">{w.project_no || 'Stock'} · {w.product_description || '—'}</div>
                {w.material === 'blocked' && <div className="text-xs text-danger">{w.material_short} short · {w.material_late} late</div>}
              </div>
              <div className="relative h-6 rounded bg-muted/40">
                <i className="absolute inset-y-0 w-px bg-primary" style={{ left: todayLeft }} />
                <div className={`absolute inset-y-1 overflow-hidden rounded ${w.delayed ? 'bg-danger/60' : 'bg-primary/60'}`} style={{ left, width }}
                  title={`${w.planned_start ? formatDate(w.planned_start) : '?'} to ${w.planned_end ? formatDate(w.planned_end) : '?'}`}>
                  <div className="h-full bg-primary" style={{ width: `${Math.round(w.progress * 100)}%` }} />
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">Bar = planned start to end, darker part = job cards done. To move dates, raise a Change Note on the Work Order.</p>
    </CardContent></Card>
  );
}
