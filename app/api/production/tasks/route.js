// Production's ad-hoc tasks — the ones on the Today calendar. Separate from milestones, which
// are a fixed per-project template with no create path.
import { NextResponse } from 'next/server';
import { execute } from '@/lib/db';
import { getSessionUser, requireDepartment } from '@/lib/auth';

export async function POST(req) {
  const user = getSessionUser();
  const denied = requireDepartment(user, 'Production');
  if (denied) return denied;

  const b = await req.json();
  const title = String(b.title || '').trim();
  const dueDate = String(b.due_date || '').trim();
  if (!title) return NextResponse.json({ error: 'Task title is required' }, { status: 400 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
    return NextResponse.json({ error: 'A valid due date is required' }, { status: 400 });
  }

  // department and created_by are server-set, never taken from the body. An unassigned task on a
  // shared department board is one nobody owns, so it falls back to whoever created it.
  const { lastId } = await execute(
    `INSERT INTO tasks (title, due_date, department, assigned_to, created_by)
     VALUES (?, ?, 'Production', ?, ?)`,
    [title, dueDate, String(b.assigned_to || '').trim() || user.username, user.username]
  );
  return NextResponse.json({ id: Number(lastId) });
}
