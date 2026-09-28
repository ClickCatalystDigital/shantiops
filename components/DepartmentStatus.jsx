// Shared "who currently has the ball, doing what" display for the Projects list
// (app/projects/page.js), against getProjectsWithStatus()'s departmentProgress — the same
// {department, trigger, fraction} shape lib/department-state.mjs's pure functions produce and the
// project-detail page's own DepartmentStateCard.jsx renders as a full card. A pill shows the
// department + its real fraction (compact — "Production · 3/12"); the secondary line shows the
// fuller descriptive text (what's actually happening — "3 job card(s) in progress, 1 held for QC").
import { Badge } from './ui/badge';

export function DepartmentPills({ departmentProgress }) {
  if (!departmentProgress?.length) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {departmentProgress.map(dp => (
        <Badge key={dp.department} variant="outline" className="text-xs font-normal">
          {dp.department}
          {dp.fraction && <span className="text-muted-foreground"> · {dp.fraction}</span>}
        </Badge>
      ))}
    </div>
  );
}

// The fuller "why is this department active right now" text, joined across every active
// department — not merely repeating the department name the pill above already shows.
export function DepartmentProgress({ departmentProgress }) {
  if (!departmentProgress?.length) return <span className="text-muted-foreground">—</span>;
  const bits = departmentProgress.map(dp => dp.trigger).filter(Boolean);
  if (!bits.length) return <span className="text-muted-foreground">—</span>;
  return <span className="text-muted-foreground">{bits.join(' · ')}</span>;
}
