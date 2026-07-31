// Tick a task off (or back on) from the calendar, the To dos rail, or the cross-department panel.
import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getSessionUser, canAccessDepartment } from '@/lib/auth';

export async function PATCH(req, { params }) {
  const user = getSessionUser();
  const task = await queryOne('SELECT id, department, from_department FROM tasks WHERE id = ?', [params.id]);
  if (!task) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Either side of a cross-department raise may resolve it (the receiver when it's done, the
  // raiser when it turns out not to be needed) — same rule the old ticket PATCH used
  // (canAccessDepartment(to) || canAccessDepartment(from)), which also lets a PM toggle any task,
  // matching the Operations-panel oversight mount (app/page.js) this route now also serves.
  const allowed = canAccessDepartment(user, task.department) ||
    (task.from_department && canAccessDepartment(user, task.from_department));
  if (!allowed) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const b = await req.json();
  if (!['open', 'done'].includes(b.status)) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
  }

  await execute('UPDATE tasks SET status = ? WHERE id = ?', [b.status, params.id]);
  return NextResponse.json({ ok: true });
}
