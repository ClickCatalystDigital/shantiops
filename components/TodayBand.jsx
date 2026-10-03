// Exception-only view: the milestones needing attention right now ("Open Actions"). Urgent (not yet
// delayed, closest deadline first) on top, Needs attention (already overdue/blocked) below — same
// grouping as Operations' per-project cards (app/page.js).
import { effectiveStatus } from '@/lib/sla';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { STATUS_DOT } from './StatusBadge';
import { Card, CardContent, CardHeader, CardTitle, CardAction } from '@/components/ui/card';
import { CheckCircle2Icon } from 'lucide-react';

const ATTENTION = new Set(['overdue', 'blocked', 'due_now', 'due_soon', 'in_progress']);

// "5d late", "due today", "3d left" — from the same daysLeft effectiveStatus already computes.
function when(m) {
  const d = m.eff.daysLeft;
  if (m.eff.code === 'blocked') return { text: 'Blocked', tone: 'text-danger' };
  if (d == null) return { text: '', tone: '' };
  if (d < 0) return { text: `${-d}d late`, tone: 'text-danger' };
  if (d === 0) return { text: 'Due today', tone: 'text-warning' };
  return { text: `${d}d left`, tone: d <= 2 ? 'text-warning' : 'text-muted-foreground' };
}

function Row({ m }) {
  const w = when(m);
  return (
    <li className="flex items-start gap-3 py-2.5">
      <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', STATUS_DOT[m.eff.code] || STATUS_DOT.gray)} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{m.milestone_label}</p>
        <p className="text-xs text-muted-foreground">
          {m.assignee ? `@${m.assignee}` : 'Unassigned'}{m.planned_end ? ` · due ${formatDate(m.planned_end)}` : ''}
        </p>
        {m.delay_reason && <p className="mt-0.5 text-xs text-warning">{m.delay_reason}</p>}
      </div>
      {w.text && <span className={cn('shrink-0 text-xs font-medium tnum', w.tone)}>{w.text}</span>}
    </li>
  );
}

function Group({ label, items }) {
  if (!items.length) return null;
  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <ul className="divide-y">{items.map(m => <Row key={m.id} m={m} />)}</ul>
    </div>
  );
}

export default function TodayBand({ milestones }) {
  const items = milestones.map(m => ({ ...m, eff: effectiveStatus(m) })).filter(m => ATTENTION.has(m.eff.code));
  const delayed = items.filter(m => ['overdue', 'blocked'].includes(m.eff.code));
  const urgent = items.filter(m => !['overdue', 'blocked'].includes(m.eff.code))
    .sort((a, b) => (a.planned_end || '').localeCompare(b.planned_end || ''));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Open Actions</CardTitle>
        <CardAction>
          <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium tnum',
            delayed.length ? 'bg-danger/10 text-danger' : items.length ? 'bg-muted text-muted-foreground' : 'bg-success/10 text-success')}>
            {items.length}
          </span>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {items.length === 0 ? (
          <div className="flex flex-col items-center gap-1.5 py-6 text-center">
            <CheckCircle2Icon className="size-6 text-success" />
            <p className="text-sm font-medium">All clear</p>
            <p className="text-xs text-muted-foreground">Nothing overdue, blocked or due soon.</p>
          </div>
        ) : (
          <>
            <Group label="Urgent" items={urgent} />
            <Group label="Needs attention" items={delayed} />
          </>
        )}
      </CardContent>
    </Card>
  );
}
