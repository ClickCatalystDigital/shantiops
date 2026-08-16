import Link from 'next/link';
import StatusBadge from './StatusBadge';
import { formatDate, formatMoney } from '@/lib/format';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { TriangleAlertIcon, CheckCircle2Icon } from 'lucide-react';

// Identity + "why delayed" only — progress/current-phase/next-milestone/est-dispatch now live in
// the Milestone Tracker (PortfolioDelayTimeline) directly below, which shows them per-stage anyway.
export default function ProjectHeader({ project, health, blocker }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-4 py-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold tracking-tight">{project.project_no} — {project.customer_name}</h1>
            <p className="text-sm text-muted-foreground">{project.description || 'No description'}</p>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span>PM <b className="text-foreground">{project.owner || '—'}</b></span>
              {project.order_value ? <span>Value <b className="text-foreground">{formatMoney(project.order_value)}</b></span> : null}
              <span>Updated {formatDate(project.updated_at)}</span>
            </div>
          </div>
          <StatusBadge status={health} />
        </div>

        {blocker ? (
          <div className="flex items-start gap-3 rounded-lg border border-danger/30 bg-danger/5 p-3">
            <TriangleAlertIcon className="mt-0.5 size-5 shrink-0 text-danger" />
            <div className="text-sm">
              <div className="font-semibold">Why is this delayed?</div>
              <div className="text-muted-foreground">
                <b className="text-foreground">{blocker.milestone_label}</b>
                {blocker.delay_category ? ` — ${blocker.delay_category}` : ''}{blocker.reason ? `: ${blocker.reason}` : ''}.{' '}
                Blocked {blocker.blockedDays}d · dispatch impact <span className="font-semibold text-danger">+{blocker.impactDays}d</span>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3 rounded-lg border border-success/30 bg-success/5 p-3 text-sm">
            <CheckCircle2Icon className="size-5 shrink-0 text-success" />
            <span>On track — no overdue or blocked milestones.</span>
          </div>
        )}

        <div>
          <Button asChild variant="outline" size="sm"><Link href={`/portal/${project.id}`}>Customer view ↗</Link></Button>
        </div>
      </CardContent>
    </Card>
  );
}
