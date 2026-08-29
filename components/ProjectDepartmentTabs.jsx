'use client';

// PM/admin all-departments view: a sidebar item per department, each rendering
// that department's panel. Only mounted for PM (heads see their own stacked panels instead).
// No wrapper Card — the panels inside are Cards themselves; double-nesting looked heavy.
import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Building2Icon } from 'lucide-react';
import { effectiveStatus } from '@/lib/sla';
import DepartmentPanel from './DepartmentPanel';
import WorkspaceSidebar from '@/components/WorkspaceSidebar';

const ATTENTION = new Set(['overdue', 'blocked']);

export default function ProjectDepartmentTabs({ departments, ...panelProps }) {
  // Deep-link department selection (Part B, e.g. BM-/DG- references land here with ?dept=) — reads
  // straight off the URL rather than threading a prop through app/projects/[id]/page.js, since this
  // is already a client component nested anywhere under a dynamic page.
  const initialDept = useSearchParams().get('dept');
  const [department, setDepartment] = useState(
    departments?.includes(initialDept) ? initialDept : departments?.[0]
  );
  if (!departments?.length) return null;

  // Departments with an overdue/blocked milestone get a red dot on their tab.
  const hot = new Set(
    (panelProps.milestones || [])
      .filter(m => ATTENTION.has(effectiveStatus(m).code))
      .map(m => m.department)
  );

  const navItems = departments.map(d => ({
    key: d,
    label: d,
    icon: Building2Icon,
    badge: hot.has(d) ? '!' : null,
  }));

  return (
    <WorkspaceSidebar title="Departments" icon={Building2Icon} items={navItems} activeKey={department} onChange={setDepartment}>
      <DepartmentPanel department={department} {...panelProps} />
    </WorkspaceSidebar>
  );
}
