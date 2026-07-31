// Hand-raised tickets — rework (sent back) or a cross-department request. Handoff tickets are
// never created here: they're server-generated only, from the milestones PATCH (lib/tickets.js
// fireHandoff), so a client can never forge one.
import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getSessionUser, isInternal, canAccessDepartment, headDepartments } from '@/lib/auth';
import { DEPARTMENTS } from '@/lib/milestones';
import { notifyDepartment } from '@/lib/tickets';

const KINDS = ['rework', 'request'];

export async function POST(req) {
  const user = getSessionUser();
  if (!isInternal(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const b = await req.json();
  const kind = KINDS.includes(b.kind) ? b.kind : null;
  const title = String(b.title || '').trim();
  const toDept = DEPARTMENTS.includes(b.to_department) ? b.to_department : null;
  if (!kind) return NextResponse.json({ error: 'Invalid ticket kind' }, { status: 400 });
  if (!title) return NextResponse.json({ error: 'Title is required' }, { status: 400 });
  if (!toDept) return NextResponse.json({ error: 'A valid department is required' }, { status: 400 });
  if (b.due_date && !/^\d{4}-\d{2}-\d{2}$/.test(b.due_date)) {
    return NextResponse.json({ error: 'Invalid due date' }, { status: 400 });
  }

  // Server-validated, never trusted as-is: a multi-department head names which of their own
  // departments is raising this; anything else falls back to their first granted department. A
  // PM has none, so from_department is null (raised "by management").
  const fromDept = b.from_department && canAccessDepartment(user, b.from_department)
    ? b.from_department
    : (headDepartments(user)[0] || null);

  const projectId = b.project_id ? Number(b.project_id) : null;
  const milestoneId = b.milestone_id ? Number(b.milestone_id) : null;
  const assignedTo = String(b.assigned_to || '').trim() || null;
  const body = String(b.body || '').trim() || null;

  // A rework ticket must name the milestone it's about — resolving it later reopens exactly this
  // milestone (app/api/tickets/[id]/route.js), so without a link there's nothing to reopen.
  // Validated against the actual row, not trusted as a bare id: it must belong to this project and
  // sit in the department the rework is addressed to.
  if (kind === 'rework') {
    if (!milestoneId) return NextResponse.json({ error: 'A milestone is required for rework' }, { status: 400 });
    const milestone = await queryOne(
      'SELECT id FROM milestones WHERE id = ? AND project_id = ? AND department = ?',
      [milestoneId, projectId, toDept]
    );
    if (!milestone) return NextResponse.json({ error: 'Milestone does not match this project/department' }, { status: 400 });
  }

  const { lastId } = await execute(
    `INSERT INTO tickets (kind, project_id, milestone_id, from_department, to_department,
       assigned_to, title, body, due_date, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [kind, projectId, milestoneId, fromDept, toDept, assignedTo, title, body, b.due_date || null, user.username]
  );
  const ticketId = Number(lastId);

  await notifyDepartment(toDept, {
    kind,
    ticket_id: ticketId,
    title: `${kind === 'rework' ? 'Rework' : 'Request'} from ${fromDept || user.display_name || user.username}`,
    body: title,
  }, { except: user.id, assignedTo });

  return NextResponse.json({ id: ticketId });
}
