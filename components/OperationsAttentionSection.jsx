// components/OperationsAttentionSection.jsx
'use client';

// Open Actions grid, now filterable by the overdue/blocked/due-soon pills (Cross-cutting item in
// DESIGN-OPS-REDESIGN.md). Selecting one or more pills is an OR filter — an item matching ANY
// selected bucket passes — matching "clicking one or more filters everything below to matching
// items" rather than requiring an item to match every selected bucket at once. No pills selected
// = unfiltered, same as before this change.
//
// Scope note: this filters the milestone-based Open Actions grid only. It does NOT yet filter
// DesignMasterTable / MasterBomTable below it — those rows carry progress fractions, not the
// per-row eff.code delay status this filter is built around. Extending to the tables needs that
// status derived per project in lib/data.js first.
import { useState, useMemo } from 'react';
import Link from 'next/link';
import FilterPills from './FilterPills';
import StatusBadge from './StatusBadge';
import { Card, CardContent, CardHeader, CardTitle, CardAction } from './ui/card';
import { formatDate } from '@/lib/format';
import { MILESTONE_FILTER_DEFS as FILTER_DEFS } from '@/lib/milestone-filters';

export default function OperationsAttentionSection({ groups, manager }) {
  const [selected, setSelected] = useState([]);

  function toggle(key) {
    setSelected(sel => sel.includes(key) ? sel.filter(k => k !== key) : [...sel, key]);
  }

  const allItems = groups.flatMap(g => g.items);
  const options = FILTER_DEFS.map(f => ({
    key: f.key, label: f.label, dot: f.dot,
    value: allItems.filter(m => f.match(m.eff.code)).length,
  }));

  const activeMatchers = FILTER_DEFS.filter(f => selected.includes(f.key));
  const filteredGroups = useMemo(() => {
    if (activeMatchers.length === 0) return groups;
    return groups
      .map(g => ({ ...g, items: g.items.filter(m => activeMatchers.some(f => f.match(m.eff.code))) }))
      .filter(g => g.items.length > 0);
  }, [groups, selected]);

  return (
    <div className="flex flex-col gap-4">
      <FilterPills options={options} selected={selected} onToggle={toggle} />

      {filteredGroups.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-muted-foreground">
          {selected.length > 0 ? 'Nothing matches the selected filters.' : 'Nothing needs attention right now. 🎉'}
        </CardContent></Card>
      ) : (
        <div className="grid items-start gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {filteredGroups.map(g => {
            const delayed = g.items.filter(m => ['overdue', 'blocked'].includes(m.eff.code));
            const urgent = g.items.filter(m => !['overdue', 'blocked'].includes(m.eff.code))
              .sort((a, b) => (a.planned_end || '').localeCompare(b.planned_end || ''));
            const row = m => (
              <Link key={m.id} href={`/projects/${m.project_id}`}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-sm transition-colors hover:bg-muted/40 -mx-2 px-2 rounded">
                <StatusBadge status={m.eff} />
                <span className="font-medium">{m.milestone_label}</span>
                {manager && <span className="text-xs text-muted-foreground">{m.assignee ? `@${m.assignee}` : 'Unassigned'}</span>}
                <span className="ml-auto text-xs text-muted-foreground tnum">{formatDate(m.planned_end)}</span>
                {m.delay_reason && <span className="w-full text-xs text-warning">⚠ {m.delay_reason}</span>}
              </Link>
            );
            return (
              <Card key={g.items[0].project_id}>
                <CardHeader className="py-4">
                  <CardTitle className="text-base">
                    <Link href={`/projects/${g.items[0].project_id}`} className="text-primary hover:underline">{g.project_no}</Link>
                    <span className="text-muted-foreground font-normal"> · {g.customer_name}</span>
                  </CardTitle>
                  <CardAction className="text-xs text-muted-foreground tnum">{g.items.length} item{g.items.length !== 1 ? 's' : ''}</CardAction>
                </CardHeader>
                <CardContent className="flex flex-col gap-3 pt-0">
                  {urgent.length > 0 && (
                    <div>
                      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Urgent</p>
                      <div className="flex flex-col divide-y">{urgent.map(row)}</div>
                    </div>
                  )}
                  {delayed.length > 0 && (
                    <div>
                      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Needs attention</p>
                      <div className="flex flex-col divide-y">{delayed.map(row)}</div>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}