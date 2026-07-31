// Tick a task off (or back on) from the calendar or the To dos rail.
import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getSessionUser, isHead, headDepartments } from '@/lib/auth';

export async function PATCH(req, { params }) {
  const user = getSessionUser();
  const task = await queryOne('SELECT id, department FROM tasks WHERE id = ?', [params.id]);
  if (!task) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Same head-only, own-department check as creating a task (app/api/production/tasks/route.js).
  if (!isHead(user) || !headDepartments(user).includes(task.department)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const b = await req.json();
  if (!['open', 'done'].includes(b.status)) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
  }

  await execute('UPDATE tasks SET status = ? WHERE id = ?', [b.status, params.id]);
  return NextResponse.json({ ok: true });
}
