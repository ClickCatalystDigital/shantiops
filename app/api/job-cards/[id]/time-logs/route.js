// Log one work session (§3.1) — multiple per worker per card, not a single running total.
import { NextResponse } from 'next/server';
import { execute } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';

export async function POST(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Production');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Production', 'production.jobcard.time_log');
  if (actionDenied) return actionDenied;

  const b = await req.json();
  const employeeId = Number(b.employee_id);
  if (!employeeId) return NextResponse.json({ error: 'Worker is required' }, { status: 400 });

  // Real clock times, when given, are the source of truth for minutes — a typed minutes number is
  // the fallback for "worked about 2.5 hours" without exact start/stop.
  let minutes = Number(b.minutes) || 0;
  if (b.from_time && b.to_time) {
    const diffMin = (new Date(b.to_time) - new Date(b.from_time)) / 60000;
    if (!(diffMin > 0)) return NextResponse.json({ error: 'End time must be after start time' }, { status: 400 });
    minutes = Math.round(diffMin);
  }
  if (!minutes || minutes <= 0) return NextResponse.json({ error: 'Enter minutes worked, or a start and end time' }, { status: 400 });

  const { lastId } = await execute(
    `INSERT INTO job_card_time_logs (job_card_id, employee_id, from_time, to_time, minutes, qty_completed, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [params.id, employeeId, b.from_time || null, b.to_time || null, minutes, Number(b.qty_completed) || 0, user.username]
  );
  return NextResponse.json({ id: Number(lastId) });
}
