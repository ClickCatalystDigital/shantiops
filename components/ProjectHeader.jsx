import Link from 'next/link';
import StatusBadge from './StatusBadge';
import { formatDate, formatMoney } from '@/lib/format';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { TriangleAlertIcon, CheckCircle2Icon, ArrowUpRightIcon, HourglassIcon } from 'lucide-react';
import EditProjectDialog from './EditProjectDialog';
import DeleteProjectDialog from './DeleteProjectDialog';
import { defaultCompany } from '@/lib/company-profiles';

// Identity + "why delayed" only — progress/current-phase/next-milestone/est-dispatch live in the
// Milestone Tracker (PortfolioDelayTimeline) above. `canEdit`/`customers`/`scopeOfSupply` back the
// Edit dialog; `canDelete` is deliberately stricter (PM + Design/Engineering Head, matching the
// DELETE route's own gate).
function Fact({ label, children }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="truncate text-sm font-medium">{children}</dd>
    </div>
  );
}

export default function ProjectHeader({ project, health, blocker, milestones = [], canEdit = false, canDelete = false, customers = [], scopeOfSupply = [] }) {
  // Dependency-blocked is a separate signal from `blocker` (biggestBlocker, SLA/human-status
  // driven, lib/sla.js) — deliberately not merged into it (SYSTEM.md §5j). Only open milestones.
  const depBlocked = milestones.filter(m => m.blocked_by && !(m.actual_end || m.status === 'done'));
  const firstDep = depBlocked[0];
  return (
    <Card>
      <CardContent className="flex flex-col gap-5 py-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium tracking-wide text-muted-foreground tnum">{project.project_no}</p>
            <h1 className="mt-0.5 text-xl font-semibold leading-tight tracking-tight">{project.customer_name}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{project.description || 'No description'}</p>
          </div>
          <StatusBadge status={health} className="shrink-0" />
        </div>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-y py-3">
          <Fact label="PM">{project.owner || '—'}</Fact>
          <Fact label="Entity">{project.company || defaultCompany()}</Fact>
          <Fact label="Value">{project.order_value ? formatMoney(project.order_value) : '—'}</Fact>
          <Fact label="Updated">{formatDate(project.updated_at)}</Fact>
        </dl>

        {blocker ? (
          <div className="flex items-start gap-2.5 rounded-lg bg-danger/5 px-3 py-2.5 ring-1 ring-danger/20">
            <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-danger" />
            <div className="text-sm">
              <p className="font-medium">Delayed at {blocker.milestone_label}</p>
              <p className="text-muted-foreground">
                {[blocker.delay_category, blocker.reason].filter(Boolean).join(': ') || 'No reason recorded'}
                {' · '}blocked {blocker.blockedDays}d · dispatch <span className="font-medium text-danger">+{blocker.impactDays}d</span>
              </p>
            </div>
          </div>
        ) : (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle2Icon className="size-4 shrink-0 text-success" />
            On track — nothing overdue or blocked.
          </p>
        )}

        {firstDep && (
          <p className="flex items-start gap-2 text-sm text-muted-foreground">
            <HourglassIcon className="mt-0.5 size-4 shrink-0" />
            <span>
              Next in line: <span className="font-medium text-foreground">{firstDep.milestone_label}</span>, after{' '}
              {firstDep.blocked_by.type === 'milestone' ? firstDep.blocked_by.label : firstDep.blocked_by.reason}
              {depBlocked.length > 1 && <span> · {depBlocked.length - 1} more waiting</span>}
            </span>
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href={`/portal/${project.id}`}>Customer view<ArrowUpRightIcon data-icon="inline-end" /></Link>
          </Button>
          {canEdit && <EditProjectDialog project={project} customers={customers} scopeOfSupply={scopeOfSupply} />}
          {canDelete && <DeleteProjectDialog project={project} />}
        </div>
      </CardContent>
    </Card>
  );
}
