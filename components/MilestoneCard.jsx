import StatusBadge from './StatusBadge';
import { formatDate } from '@/lib/format';

export default function MilestoneCard({ m, onClick }) {
  return (
    <button
      onClick={onClick}
      title="Click to update"
      className="flex w-full flex-col gap-2 rounded-lg border bg-card p-3 text-left transition-colors hover:border-primary/40 hover:bg-accent/40"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm font-medium leading-snug">{m.milestone_label}</span>
        <StatusBadge m={m} />
      </div>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>{m.department || '—'}</span>
        <span>·</span>
        <span>{m.assignee ? `@${m.assignee}` : 'Unassigned'}</span>
      </div>
      <div className="text-xs text-muted-foreground tnum">{formatDate(m.planned_start)} → {formatDate(m.planned_end)}</div>
      {m.delay_reason && (
        <div className="text-xs text-warning">⚠ {m.delay_category ? `${m.delay_category}: ` : ''}{m.delay_reason}</div>
      )}
      {m.blocked_by && (
        <div className="text-xs text-muted-foreground">
          ⏳ Waiting on {m.blocked_by.type === 'milestone'
            ? `${m.blocked_by.department}: ${m.blocked_by.label}`
            : m.blocked_by.reason}
        </div>
      )}
      {m.out_of_order && (
        <div className="text-xs text-warning" title="Finished before its own predecessor — worth a look, not blocked on it.">
          ⚠ Finished ahead of {m.out_of_order.department}: {m.out_of_order.label}
        </div>
      )}
    </button>
  );
}
