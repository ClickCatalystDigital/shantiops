// Exception-only view: the milestones needing attention right now. Renamed "Open Actions" (from
// "Needs Attention") — same rename/regroup as Operations' per-project cards (app/page.js): Urgent
// (not yet delayed, closest deadline first) on top, Needs attention (already overdue/blocked) below.
import StatusBadge from './StatusBadge';
import { effectiveStatus } from '@/lib/sla';
import { formatDate } from '@/lib/format';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const ATTENTION = new Set(['overdue', 'blocked', 'due_now', 'due_soon', 'in_progress']);

function Row({ m }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-sm">
      <StatusBadge status={m.eff} />
      <span className="font-medium">{m.milestone_label}</span>
      <span className="text-xs text-muted-foreground">{m.assignee ? `@${m.assignee}` : 'Unassigned'}</span>
      <span className="ml-auto text-xs text-muted-foreground tnum">{formatDate(m.planned_end)}</span>
      {m.delay_reason && <span className="w-full text-xs text-warning">⚠ {m.delay_reason}</span>}
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
      <CardHeader><CardTitle>Open Actions — {items.length}</CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-3">
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing overdue, blocked, or due soon. 🎉</p>
        ) : (
          <>
            {urgent.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Urgent</p>
                <div className="flex flex-col divide-y">{urgent.map(m => <Row key={m.id} m={m} />)}</div>
              </div>
            )}
            {delayed.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Needs attention</p>
                <div className="flex flex-col divide-y">{delayed.map(m => <Row key={m.id} m={m} />)}</div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
