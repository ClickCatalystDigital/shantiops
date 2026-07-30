// Close/reopen a ticket, reassign it, or push its due date. Either side of a handoff may act on
// it — the receiver when the work's done, the raiser when it turns out not to be needed.
import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getSessionUser, canAccessDepartment } from '@/lib/auth';

const EDITABLE = ['status', 'assigned_to', 'due_date'];

export async function PATCH(req, { params }) {
  const user = getSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const ticket = await queryOne('SELECT * FROM tickets WHERE id = ?', [params.id]);
  if (!ticket) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const allowed = canAccessDepartment(user, ticket.to_department) ||
    (ticket.from_department && canAccessDepartment(user, ticket.from_department));
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const b = await req.json();
  const keys = Object.keys(b).filter(k => EDITABLE.includes(k));
  if (!keys.length) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
  if (keys.includes('status') && !['open', 'done'].includes(b.status)) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
  }
  if (keys.includes('due_date') && b.due_date && !/^\d{4}-\d{2}-\d{2}$/.test(b.due_date)) {
    return NextResponse.json({ error: 'Invalid due date' }, { status: 400 });
  }

  const sets = [];
  const args = [];
  for (const k of keys) { sets.push(`${k} = ?`); args.push(b[k] === '' ? null : b[k]); }
  if (keys.includes('status')) {
    if (b.status === 'done') { sets.push('closed_by = ?', 'closed_at = CURRENT_TIMESTAMP'); args.push(user.username); }
    else { sets.push('closed_by = NULL', 'closed_at = NULL'); }
  }
  args.push(params.id);
  await execute(`UPDATE tickets SET ${sets.join(', ')} WHERE id = ?`, args);
  return NextResponse.json({ ok: true });
}
