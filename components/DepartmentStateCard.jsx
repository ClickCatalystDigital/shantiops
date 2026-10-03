// "Currently with" — getDepartmentState()'s array, one row per department that has live work on this
// project right now (several at once is normal, e.g. Procurement + Stores). Each row: the department
// (same icon as its nav tab), what it is doing, and — only where a real count exists — a slim bar.
// The Projects list renders the same {department, trigger, fraction} shape compactly
// (DepartmentStatus.jsx).
import { Card, CardHeader, CardTitle, CardContent, CardAction } from './ui/card';
import {
  PencilRulerIcon, NetworkIcon, ShoppingCartIcon, WarehouseIcon, HardHatIcon, FlaskConicalIcon,
  PackageIcon, MapPinIcon, CircleDotIcon, CheckCircle2Icon,
} from 'lucide-react';

const DEPT = {
  Design: { icon: PencilRulerIcon }, Engineering: { icon: NetworkIcon }, Procurement: { icon: ShoppingCartIcon },
  Stores: { icon: WarehouseIcon }, Production: { icon: HardHatIcon }, QC: { icon: FlaskConicalIcon },
  Dispatch: { icon: PackageIcon }, Installation: { icon: MapPinIcon, label: 'Service' },
};

function parseFraction(f) {
  const m = /^(\d+)\/(\d+)$/.exec(String(f || ''));
  if (!m || !Number(m[2])) return null;
  return { done: Number(m[1]), total: Number(m[2]) };
}

export default function DepartmentStateCard({ departments = [] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Currently With</CardTitle>
        {departments.length > 0 && (
          <CardAction><span className="text-xs text-muted-foreground">{departments.length} department{departments.length === 1 ? '' : 's'}</span></CardAction>
        )}
      </CardHeader>
      <CardContent>
        {departments.length === 0 ? (
          <div className="flex flex-col items-center gap-1.5 py-6 text-center">
            <CheckCircle2Icon className="size-6 text-success" />
            <p className="text-sm font-medium">Nothing in progress</p>
            <p className="text-xs text-muted-foreground">Every department has cleared its work here.</p>
          </div>
        ) : (
          <ul className="flex flex-col gap-4">
            {departments.map(d => {
              const meta = DEPT[d.department] || { icon: CircleDotIcon };
              const Icon = meta.icon;
              const frac = parseFraction(d.fraction);
              return (
                <li key={d.department} className="flex items-start gap-3">
                  <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/8 text-primary ring-1 ring-primary/10">
                    <Icon className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="text-sm font-medium">{meta.label || d.department}</p>
                      {d.fraction && <span className="text-xs text-muted-foreground tnum">{d.fraction}</span>}
                    </div>
                    {d.trigger && <p className="text-xs text-muted-foreground">{d.trigger}</p>}
                    {frac && (
                      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, (frac.done / frac.total) * 100)}%` }} />
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
