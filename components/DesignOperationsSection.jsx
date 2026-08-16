// components/DesignOperationsSection.jsx
'use client';

// Wraps DesignOperationsCard with the filter pills, placed in their own row above the card
// (top-right), not inside it. Pills filter the card's Incidents and Projects table by matching
// project — since incidents/table rows don't carry an overdue/blocked/due-soon status themselves,
// only milestones do, this works by finding which projects have a matching milestone, then only
// showing that project's incidents and table row. The flow diagram stays unfiltered (its numbers
// are totals across all projects, not a per-project list).
import { useState, useMemo } from 'react';
import FilterPills from './FilterPills';
import DesignOperationsCard from './DesignOperationsCard';
import { MILESTONE_FILTER_DEFS as FILTER_DEFS } from '@/lib/milestone-filters';

export default function DesignOperationsSection({ groups, counts, designWork, outgoing, incoming, sourcingItems }) {
  const [selected, setSelected] = useState([]);

  function toggle(key) {
    setSelected(sel => sel.includes(key) ? sel.filter(k => k !== key) : [...sel, key]);
  }

  const allItems = groups.flatMap(g => g.items);
  // Was counting matching milestone items (e.g. one project with 4 overdue tasks counted as 4) —
  // switched to counting distinct projects, since that's the unit everything else on this page
  // (the table, the incidents) is scoped to. "13 overdue" now means 13 projects, matching what
  // filterProjectIds already narrows the table/incidents down to below.
  const options = FILTER_DEFS.map(f => {
    const matchingProjectIds = new Set(allItems.filter(m => f.match(m.eff.code)).map(m => m.project_id));
    return { key: f.key, label: f.label, dot: f.dot, value: matchingProjectIds.size };
  });

  const activeMatchers = FILTER_DEFS.filter(f => selected.includes(f.key));
  const filterProjectIds = useMemo(() => {
    if (activeMatchers.length === 0) return null;
    const ids = new Set();
    allItems.forEach(m => { if (activeMatchers.some(f => f.match(m.eff.code))) ids.add(m.project_id); });
    return ids;
  }, [groups, selected]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <FilterPills options={options} selected={selected} onToggle={toggle} />
      </div>
      <DesignOperationsCard counts={counts} designWork={designWork} outgoing={outgoing} incoming={incoming}
        sourcingItems={sourcingItems} filterProjectIds={filterProjectIds} />
    </div>
  );
}