// Ad-hoc tasks on the Tasks calendar — every department's own board, plus (since the ticket→task
// collapse) the cross-department "raise this for another department" surface that used to be a
// `POST /api/tickets`. Separate from milestones, which are a fixed per-project template with no
// create path.
import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, isInternal, isHead, headDepartments, canAccessDepartment } from '@/lib/auth';
import { DEPARTMENTS } from '@/lib/milestones';
import { notifyDepartment } from '@/lib/notify';

export async function POST(req) {
  const user = await getFreshSessionUser();
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
  const body = String(b.body || '').trim() || null;

  // A cancel-request (§ Procurement cancel-request flow) — a task with bom_item_id set, always
  // aimed at Procurement, the only department that owns purchase_status. Validated against the
  // item's own project_id rather than trusted from the body, same boundary as every other
  // client-supplied id in this app.
  let bomItemId = null;
  if (b.bom_item_id) {
    if (department !== 'Procurement') {
      return NextResponse.json({ error: 'Cancel requests can only be sent to Procurement' }, { status: 400 });
    }
    const item = await queryOne('SELECT id FROM bom_items WHERE id = ? AND project_id = ?', [b.bom_item_id, projectId]);
    if (!item) return NextResponse.json({ error: 'BOM item not found on this project' }, { status: 404 });
    bomItemId = item.id;
  }

  // created_by is server-set, never taken from the body. An unassigned task on a shared
  // department board is one nobody owns, so it falls back to whoever created it.
  const assignedTo = String(b.assigned_to || '').trim() || user.username;
  const { lastId } = await execute(
    `INSERT INTO tasks (title, due_date, department, assigned_to, created_by, from_department, project_id, bom_item_id, body)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [title, dueDate, department, assignedTo, user.username, fromDepartment, projectId, bomItemId, body]
  );
  const taskId = Number(lastId);

  // Cross-department raise -> the signal half of "notification + task" (see lib/notify.js's
  // header comment). A self-department task (no from_department) is just your own board, nobody
  // else needs telling.
  if (fromDepartment) {
    await notifyDepartment(department, {
      kind: 'request',
      task_id: taskId,
      title: bomItemId ? `Cancel request from ${fromDepartment}` : `Task from ${fromDepartment}`,
      body: title,
    }, { except: user.id, assignedTo });
  }

  return NextResponse.json({ id: taskId });
}
