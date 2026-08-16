import { effectiveStatus } from '@/lib/sla';
import { cn } from '@/lib/utils';
import { TONE_CLASS } from '@/lib/status-styles';

// Soft tinted status pill — colors come from the shared tone palette (lib/status-styles.js), the
// same one CalcWorkspace/DesignPanel badges use, so a pill here and a Badge there never drift.
const STYLES = {
  done: TONE_CLASS.success,
  overdue: TONE_CLASS.danger,
  blocked: TONE_CLASS.danger, // --blocked is aliased to --danger at the token level
  due_now: TONE_CLASS.warning,
  due_soon: TONE_CLASS.warning,
  in_progress: TONE_CLASS.info,
  not_started: TONE_CLASS.neutral,
  gray: TONE_CLASS.neutral,
};

const DOT = {
  done: 'bg-success', overdue: 'bg-danger', blocked: 'bg-blocked',
  due_now: 'bg-warning', due_soon: 'bg-warning', in_progress: 'bg-info',
  not_started: 'bg-muted-foreground', gray: 'bg-muted-foreground',
};

export default function StatusBadge({ m, status, className }) {
  const s = status || effectiveStatus(m);
  return (
    <span className={cn(
      'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap',
      STYLES[s.code] || STYLES.gray,
      className
    )}>
      <span className={cn('size-1.5 rounded-full', DOT[s.code] || DOT.gray)} />
      {s.label}
    </span>
  );
}