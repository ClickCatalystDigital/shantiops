// Project View redesign, Part 2/Row 2 slot 3 — replaces the old milestone-only "Currently With"
// card. Renders getDepartmentState()'s array directly: can show more than one department at once
// (e.g. Procurement + Stores, a real, expected overlap — never forced to a single "current"
// department), each with its own real trigger and, only where one genuinely exists, a fraction.
// Deliberately independent of DepartmentStatus.jsx's DepartmentPills/DepartmentProgress — those stay
// exactly as they are, still shared with the Projects list (lib/data.js's activeDepartmentStatus),
// which this redesign does not touch.
import { Card, CardHeader, CardTitle, CardContent } from './ui/card';
import { Badge } from './ui/badge';

export default function DepartmentStateCard({ departments = [] }) {
  return (
    <Card>
      <CardHeader><CardTitle>Currently With</CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-3">
        {departments.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing currently active — every department has cleared its work here.</p>
        ) : departments.map(d => (
          <div key={d.department} className="flex flex-col gap-0.5">
            <div className="flex items-center gap-2">
              <Badge variant="outline">{d.department}</Badge>
              {d.fraction && <span className="text-xs text-muted-foreground tnum">{d.fraction}</span>}
            </div>
            {d.trigger && <p className="text-sm text-muted-foreground">{d.trigger}</p>}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
