// Ad-hoc tasks on the Tasks calendar — every department's own board now, not just Production's.
// Separate from milestones, which are a fixed per-project template with no create path.
import { NextResponse } from 'next/server';
import { execute } from '@/lib/db';
import { getSessionUser, isHead, headDepartments } from '@/lib/auth';
import { DEPARTMENTS } from '@/lib/milestones';

export async function POST(req) {
  const user = getSessionUser();
  const b = await req.json();
  // Head-only surface, same as the page gate (app/production/page.js) — PMs don't get a Tasks
  // board, so canAccessDepartment (which lets them through) is deliberately not used here.
  const department = isHead(user) && DEPARTMENTS.includes(b.department) && headDepartments(user).includes(b.department)
    ? b.department : null;
  if (!department) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const title = String(b.title || '').trim();
  const dueDate = String(b.due_date || '').trim();
  if (!title) return NextResponse.json({ error: 'Task title is required' }, { status: 400 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
    return NextResponse.json({ error: 'A valid due date is required' }, { status: 400 });
  }

  // created_by is server-set, never taken from the body. An unassigned task on a shared
  // department board is one nobody owns, so it falls back to whoever created it.
  const { lastId } = await execute(
    `INSERT INTO tasks (title, due_date, department, assigned_to, created_by)
     VALUES (?, ?, ?, ?, ?)`,
    [title, dueDate, department, String(b.assigned_to || '').trim() || user.username, user.username]
  );
  return NextResponse.json({ id: Number(lastId) });
}
