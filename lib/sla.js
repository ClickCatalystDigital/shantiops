// lib/sla.js
// Status + SLA logic. Two layers:
//   slaStatus()       — pure deadline colour (green/yellow/orange/red) off planned_end vs today.
//   effectiveStatus() — merges the human status (pending/in_progress/done/blocked) WITH the deadline
//                       into the richer code set the UI paints (see globals.css for actual colors):
//                       not_started(muted) in_progress(info) blocked(danger)
//                       due_now(warning) overdue(danger) done(success)
//                       [due_soon currently folded into not_started, see effectiveStatus() below]

export function daysBetween(a, b) {
  const MS = 24 * 60 * 60 * 1000;
  return Math.round((b - a) / MS);
}

function todayMidnight(today) {
  return new Date(today.toDateString());
}

export function slaStatus(milestone, today = new Date()) {
  if (milestone.actual_end) return { code: 'done', label: 'Complete', daysLeft: null };
  if (!milestone.planned_end) return { code: 'gray', label: 'Not scheduled', daysLeft: null };

  const daysLeft = daysBetween(todayMidnight(today), new Date(milestone.planned_end));
  if (daysLeft < 0) return { code: 'red', label: `Overdue ${Math.abs(daysLeft)}d`, daysLeft };
  if (daysLeft <= 2) return { code: 'orange', label: `${daysLeft}d left`, daysLeft };
  if (daysLeft <= 7) return { code: 'yellow', label: `${daysLeft}d left`, daysLeft };
  return { code: 'green', label: `${daysLeft}d left`, daysLeft };
}

// The single richest status code for a milestone, used for cards, swimlane capsules and roll-ups.
export function effectiveStatus(m, today = new Date()) {
  if (m.actual_end || m.status === 'done') return { code: 'done', label: 'Completed', daysLeft: null };

  // A rework ticket reopened this after it was once Closed (app/api/tickets/[id]/route.js) — say
  // so on every badge rather than letting it read as a stage that simply never finished on time.
  // Same severity tier as a plain in_progress/overdue/etc read, just an honest label suffix —
  // not a new status code.
  const suffix = m.reopened_at ? ' (Reopened)' : '';
  if (m.status === 'blocked') return { code: 'blocked', label: `Blocked${suffix}`, daysLeft: null };

  const sla = slaStatus(m, today);
  if (sla.code === 'red') return { code: 'overdue', label: `${sla.label}${suffix}`, daysLeft: sla.daysLeft };
  if (m.status === 'in_progress') return { code: 'in_progress', label: `In progress${suffix}`, daysLeft: sla.daysLeft };
  if (sla.code === 'orange') return { code: 'due_now', label: `${sla.label}${suffix}`, daysLeft: sla.daysLeft };
  // due_soon (sla.code === 'yellow') intentionally folded into not_started for now —
  // one fewer status color for first-time viewers to learn. Re-enable by uncommenting
  // below if "approaching deadline, not yet started" needs its own signal later.
  // if (sla.code === 'yellow') return { code: 'due_soon', label: sla.label, daysLeft: sla.daysLeft };
  return { code: 'not_started', label: `Not started${suffix}`, daysLeft: sla.daysLeft };
}

// Higher = more urgent. Drives roll-up + biggestBlocker selection.
const SEVERITY = { overdue: 6, blocked: 5, due_now: 4, due_soon: 3, in_progress: 2, not_started: 1, done: 0, gray: 1 };

export function worstStatus(milestones, today = new Date()) {
  let worst = { code: 'done', label: 'Complete' };
  for (const m of milestones) {
    const s = effectiveStatus(m, today);
    if ((SEVERITY[s.code] ?? 0) > (SEVERITY[worst.code] ?? 0)) worst = s;
  }
  return worst;
}

// The one milestone answering "why is this delayed?" — worst open milestone + its delay context.
// Returns null when nothing is overdue/blocked (project is healthy).
export function biggestBlocker(milestones, today = new Date()) {
  let pick = null, pickSev = 2; // only surface things at least as bad as due_now (>=4); ignore in_progress
  for (const m of milestones) {
    const s = effectiveStatus(m, today);
    const sev = SEVERITY[s.code] ?? 0;
    if (sev >= 4 && sev > pickSev) { pick = { m, s }; pickSev = sev; }
  }
  if (!pick) return null;
  const { m, s } = pick;
  const t0 = todayMidnight(today);
  // Blocked-since: from planned_end if we're past it, else from actual_start.
  const anchor = m.planned_end && new Date(m.planned_end) < t0 ? new Date(m.planned_end)
    : (m.actual_start ? new Date(m.actual_start) : t0);
  const blockedDays = Math.max(daysBetween(anchor, t0), 0);
  const impactDays = s.code === 'overdue' ? Math.abs(s.daysLeft) : blockedDays;
  return {
    milestone_label: m.milestone_label,
    department: m.department,
    code: s.code,
    delay_category: m.delay_category || null,
    reason: m.delay_reason || null,
    blockedDays,
    impactDays,
  };
}
