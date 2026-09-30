'use client';

// Planning -> Capacity: weekly load vs capacity per workstation (lib/capacity.mjs does the maths).
// Click a cell to see which Work Orders are loading it. "Set capacity" edits shifts/hours/days.
import { useEffect, useState } from 'react';
import { api, showToast, formatDate } from '@/lib/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SettingsIcon } from 'lucide-react';

const hrs = m => `${Math.round(m / 6) / 10}h`;
const tone = b => b.overloaded ? 'bg-danger/20 text-danger' : b.utilisation > 0.8 ? 'bg-warning/20 text-warning' : b.load > 0 ? 'bg-success/15 text-success' : 'text-muted-foreground';

export default function CapacityTab() {
  const [d, setD] = useState(null);
  const [sel, setSel] = useState(null);      // { station, bucket }
  const [edit, setEdit] = useState(false);

  async function load() {
    try { setD(await api('/api/plan/capacity?weeks=8')); } catch (e) { showToast(e.message, 'error'); setD({ weeks: [], stations: [], bottlenecks: [], stations_config: [] }); }
  }
  useEffect(() => { load(); }, []);
  if (!d) return <p className="py-10 text-center text-sm text-muted-foreground">Loading capacity…</p>;

  async function save(id, field, value) {
    try { await api(`/api/workstations/${id}`, { method: 'PATCH', body: { [field]: value } }); await load(); }
    catch (e) { showToast(e.message, 'error'); }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="font-medium">{d.bottlenecks.length ? `${d.bottlenecks.length} overloaded week${d.bottlenecks.length > 1 ? 's' : ''}` : 'No overloaded weeks'}</span>
        {d.undatedOps > 0 && <span className="text-warning">{d.undatedOps} operation(s) have no Work Order dates — spread over 14 days</span>}
        <Button className="ml-auto" size="sm" variant="outline" onClick={() => setEdit(e => !e)}><SettingsIcon />Set capacity</Button>
      </div>

      {edit && (
        <Card><CardContent className="grid gap-2 pt-4 text-sm">
          <p className="text-muted-foreground">Capacity per week = shifts/day × hours/shift × working days. Default is one 8-hour shift, 6 days.</p>
          {d.stations_config.map(s => (
            <div key={s.id} className="flex flex-wrap items-center gap-3">
              <span className="w-40 font-medium">{s.name}</span>
              {[['shifts_per_day', 'shifts/day'], ['hours_per_shift', 'hrs/shift'], ['working_days_per_week', 'days/week']].map(([f, l]) => (
                <label key={f} className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Input className="h-8 w-16" type="number" step="0.5" defaultValue={s[f]}
                    onBlur={e => Number(e.target.value) !== Number(s[f]) && save(s.id, f, e.target.value)} />{l}
                </label>
              ))}
            </div>
          ))}
        </CardContent></Card>
      )}

      <Card><CardContent className="overflow-x-auto pt-4">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-muted-foreground">
            <th className="py-1 pr-3">Workstation</th>
            {d.weeks.map(w => <th key={w} className="px-1 text-center font-normal">{formatDate(w).replace(/ \d{4}$/, '')}</th>)}
          </tr></thead>
          <tbody>
            {d.stations.map(s => (
              <tr key={s.id} className="border-t">
                <td className="py-1.5 pr-3"><div className="font-medium">{s.name}</div><div className="text-xs text-muted-foreground">{hrs(s.weekly_capacity)}/wk</div></td>
                {s.buckets.map(b => (
                  <td key={b.week} className="p-1">
                    <button onClick={() => setSel({ station: s, bucket: b })}
                      className={`tnum w-full rounded-md px-1 py-1.5 text-center text-xs transition-colors hover:ring-1 hover:ring-primary ${tone(b)}`}>
                      {b.load ? `${Math.round(b.utilisation * 100)}%` : '–'}
                    </button>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-muted-foreground">Red = over capacity, amber = over 80%. Minutes of each open operation are spread over its Work Order&apos;s remaining dates.</p>
      </CardContent></Card>

      {sel && (
        <Card><CardContent className="pt-4 text-sm">
          <div className="mb-2 flex items-baseline gap-2">
            <h3 className="font-semibold">{sel.station.name} · week of {formatDate(sel.bucket.week)}</h3>
            <span className="text-muted-foreground">{hrs(sel.bucket.load)} of {hrs(sel.station.weekly_capacity)}</span>
            <Button className="ml-auto" size="sm" variant="ghost" onClick={() => setSel(null)}>Close</Button>
          </div>
          {sel.bucket.wos.length === 0 ? <p className="text-muted-foreground">Nothing scheduled.</p> : (
            <ul className="divide-y">{sel.bucket.wos.map(w => <li key={w.wo_id} className="flex justify-between py-1.5"><span>{w.wo_no}</span><span className="tnum text-muted-foreground">{hrs(w.minutes)}</span></li>)}</ul>
          )}
          {sel.bucket.overloaded && <p className="mt-2 text-xs text-danger">Over capacity: move a Work Order&apos;s dates, add a shift above, or outsource an operation.</p>}
        </CardContent></Card>
      )}
    </div>
  );
}
