// Ad-hoc tasks on the Tasks calendar — every department's own board, plus (since the ticket→task
// collapse) the cross-department "raise this for another department" surface that used to be a
// `POST /api/tickets`. Separate from milestones, which are a fixed per-project template with no
// create path.
import { NextResponse } from 'next/server';
import { execute } from '@/lib/db';
import { getSessionUser, isInternal, isHead, headDepartments, canAccessDepartment } from '@/lib/auth';
import { DEPARTMENTS } from '@/lib/milestones';
import { notifyDepartment } from '@/lib/notify';

export async function POST(req) {
  const user = getSessionUser();
  if (!isInternal(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const b = await req.json();

  const department = DEPARTMENTS.includes(b.department) ? b.department : null;
  if (!department) return NextResponse.json({ error: 'A valid department is required' }, { status: 400 });

  // Two callers land here, distinguished by whether the body carries from_department at all — NOT
  // by re-deriving "is this their own department" from headDepartments overlap, which breaks the
  // moment one person is granted two departments (a real case in this app: a head can hold several
  // departments, same as a PM holds all of them). The plain Tasks-tab composer
  // (components/ProductionToday.jsx) never sends from_department — own board, requires being an
  // actual head of the target department. The cross-department panel
  // (components/TicketsPanel.jsx) always sends it — validated via canAccessDepartment, the exact
  // rule POST /api/tickets used to use (true for a PM on any department, true for a head only on
  // their own granted ones) — and needs no further check against the target department, matching
  // that route's own permissiveness (it never blocked from===to either).
  let fromDepartment = null;
  if (b.from_department) {
    if (!canAccessDepartment(user, b.from_department)) {
      return NextResponse.json({ error: 'Not your department' }, { status: 403 });
    }
    fromDepartment = b.from_department;
  } else if (!isHead(user) || !headDepartments(user).includes(department)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const title = String(b.title || '').trim();
  const dueDate = String(b.due_date || '').trim();
  if (!title) return NextResponse.json({ error: 'Task title is required' }, { status: 400 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
    return NextResponse.json({ error: 'A valid due date is required' }, { status: 400 });
  }
  const projectId = b.project_id ? Number(b.project_id) : null;

  // created_by is server-set, never taken from the body. An unassigned task on a shared
  // department board is one nobody owns, so it falls back to whoever created it.
  const assignedTo = String(b.assigned_to || '').trim() || user.username;
  const { lastId } = await execute(
    `INSERT INTO tasks (title, due_date, department, assigned_to, created_by, from_department, project_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [title, dueDate, department, assignedTo, user.username, fromDepartment, projectId]
  );
  const taskId = Number(lastId);

  // Cross-department raise -> the signal half of "notification + task" (see lib/notify.js's
  // header comment). A self-department task (no from_department) is just your own board, nobody
  // else needs telling.
  if (fromDepartment) {
    await notifyDepartment(department, {
      kind: 'request',
      task_id: taskId,
      title: `Task from ${fromDepartment}`,
      body: title,
    }, { except: user.id, assignedTo });
  }

  return NextResponse.json({ id: taskId });
}
