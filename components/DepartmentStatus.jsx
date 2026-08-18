// Shared "who currently has the ball, doing what" display — a pill row (department + the specific
// milestone that's actually active there) + that department's own milestone progress. Built for the
// Projects list (app/projects/page.js) against getProjectsWithStatus()'s departmentProgress; the
// project-detail page's Row 2 slot 3 reuses it against the same shape (lib/data.js's
// activeDepartmentStatus), scoped to one project's own milestones instead of every project's.
import { Badge } from './ui/badge';

export function DepartmentPills({ departmentProgress }) {
  if (!departmentProgress?.length) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {departmentProgress.map(dp => (
        <Badge key={dp.department} variant="outline" className="text-xs font-normal">
          {dp.department}
          {dp.activeMilestones?.length > 0 && <span className="text-muted-foreground"> · {dp.activeMilestones.join(', ')}</span>}
        </Badge>
      ))}
    </div>
  );
}

// Answers a different question from the pill above: not "who has it" but "how far along is that
// department's own slice of this project" — done/total of just the milestones that department
// owns here. A project with no active department (nothing started yet) shows nothing.
export function DepartmentProgress({ departmentProgress }) {
  if (!departmentProgress?.length) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="text-muted-foreground">
      {departmentProgress.map(dp => `${dp.department} ${dp.done}/${dp.total}`).join(', ')}
    </span>
  );
}
