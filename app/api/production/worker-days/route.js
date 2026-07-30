// One row per worker per day: attendance + the single thing they worked on. Upsert on the
// UNIQUE(worker_id, date) key so the card can just re-save itself on every change.
//
// IMPORTANT: `excluded.*` overwrites EVERY column, so the client must send the COMPLETE row each
// time, not just the field that changed — otherwise flipping the attendance select would silently
// wipe the project/milestone/notes. COALESCE would be the alternative, but then you could never
// clear a field back to empty, which is worse. created_by is deliberately left out of the UPDATE:
// it stays as whoever first marked the day.
import { NextResponse } from 'next/server';
import { execute } from '@/lib/db';
import { getSessionUser, requireDepartment } from '@/lib/auth';

const STATUSES = ['present', 'half', 'absent'];

export async function POST(req) {
  const user = getSessionUser();
  const denied = requireDepartment(user, 'Production');
  if (denied) return denied;

  const b = await req.json();
  const workerId = Number(b.worker_id);
  const date = String(b.date || '').trim();
  if (!workerId) return NextResponse.json({ error: 'Worker is required' }, { status: 400 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'A valid date is required' }, { status: 400 });
  }
  // No CHECK constraint on the column, and the upsert makes bad data sticky — validate here.
  if (!STATUSES.includes(b.status)) {
    return NextResponse.json({ error: 'Invalid attendance status' }, { status: 400 });
  }

  // Absent means there's no work to record — drop any project/milestone/notes rather than leave
  // yesterday's answer sitting behind a contradictory status.
  const absent = b.status === 'absent';
  const projectId = absent ? null : Number(b.project_id) || null;
  const milestoneId = absent ? null : Number(b.milestone_id) || null;
  const notes = absent ? null : String(b.notes || '').trim() || null;

  await execute(
    `INSERT INTO worker_days (worker_id, date, status, project_id, milestone_id, notes, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(worker_id, date) DO UPDATE SET
       status = excluded.status,
       project_id = excluded.project_id,
       milestone_id = excluded.milestone_id,
       notes = excluded.notes`,
    [workerId, date, b.status, projectId, milestoneId, notes, user.username]
  );
  return NextResponse.json({ ok: true });
}
