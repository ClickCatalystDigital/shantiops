'use client';

// PM/admin all-departments view: a sidebar item per department, each rendering
// that department's panel. Only mounted for PM (heads see their own stacked panels instead).
// No wrapper Card — the panels inside are Cards themselves; double-nesting looked heavy.
import { useState } from 'react';
import { Building2Icon } from 'lucide-react';
import { effectiveStatus } from '@/lib/sla';
import DepartmentPanel from './DepartmentPanel';
import WorkspaceSidebar from '@/components/WorkspaceSidebar';

const ATTENTION = new Set(['overdue', 'blocked']);

export default function ProjectDepartmentTabs({ departments, ...panelProps }) {
  const [department, setDepartment] = useState(departments?.[0]);
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
