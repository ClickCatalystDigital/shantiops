// Tick a task off (or back on) from the calendar or the today rail.
import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getSessionUser, requireDepartment } from '@/lib/auth';

export async function PATCH(req, { params }) {
  const user = getSessionUser();
  const denied = requireDepartment(user, 'Production');
  if (denied) return denied;

  const task = await queryOne('SELECT id FROM tasks WHERE id = ?', [params.id]);
  if (!task) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const b = await req.json();
  if (!['open', 'done'].includes(b.status)) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
  }

  await execute('UPDATE tasks SET status = ? WHERE id = ?', [b.status, params.id]);
  return NextResponse.json({ ok: true });
}
