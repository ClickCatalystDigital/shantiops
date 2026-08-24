// components/OperationsFilterBar.jsx
'use client';

// One shared FilterPills row for the whole Operations page (operations-tab-changes.md), sitting
// above every unified department card and filtering all of them at once — generalizes
// DesignOperationsSection.jsx, which owned pills per-card before any other department had a
// unified card of its own. `groups` (milestone eff.code data) is already page-scoped to whichever
// departments are in view, so the derived project-id set naturally covers every card below.
import { useState, useMemo } from 'react';
import FilterPills from './FilterPills';
import OperationsCard from './OperationsCard';
import { MILESTONE_FILTER_DEFS as FILTER_DEFS } from '@/lib/milestone-filters';

export default function OperationsFilterBar({ groups, cards }) {
  const [selected, setSelected] = useState([]);

  function toggle(key) {
    setSelected(sel => sel.includes(key) ? sel.filter(k => k !== key) : [...sel, key]);
  }

  const allItems = groups.flatMap(g => g.items);
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
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <FilterPills options={options} selected={selected} onToggle={toggle} />
      </div>
      {cards.map(c => <OperationsCard key={c.dept} {...c} filterProjectIds={filterProjectIds} />)}
    </div>
  );
}
