// Close/reopen a ticket, reassign it, or push its due date. Either side of a handoff may act on
// it — the receiver when the work's done, the raiser when it turns out not to be needed.
//
// Resolving a ticket has real consequences on the milestone it points at (milestone_id — see
// lib/tickets.js fireHandoff for handoff, and the rework selector in components/TicketsPanel.jsx):
// resolving a handoff starts the receiving milestone; resolving a rework reopens one that was
// already closed, and tells whoever the reopened milestone had already handed off to that the
// work isn't actually finished. Every status transition is logged to the app's generic audit
// trail (usb_audit, despite the name — see lib/usb.js audit()).
import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getSessionUser, canAccessDepartment } from '@/lib/auth';
import { audit } from '@/lib/usb';
import { notifyDepartment } from '@/lib/tickets';
import { todayISO } from '@/lib/date';

const EDITABLE = ['status', 'assigned_to', 'due_date'];
const MILESTONE_DONE = "(actual_end IS NOT NULL OR status = 'done')";

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

  const statusChanged = keys.includes('status') && b.status !== ticket.status;
  if (statusChanged) {
    await audit('ticket_status_change', {
      actor: user.username,
      detail: JSON.stringify({ ticket_id: ticket.id, kind: ticket.kind, from: ticket.status, to: b.status }),
    });
  }

  if (statusChanged && b.status === 'done' && ticket.milestone_id) {
    if (ticket.kind === 'handoff') {
      // milestone_id already IS the receiving milestone — fireHandoff (lib/tickets.js) recorded it
      // there using the live per-project handoff chain, so there's nothing to re-derive here.
      // Guarded on actual_start IS NULL: a no-op if someone already started it by hand.
      await execute(
        `UPDATE milestones SET status = 'in_progress', actual_start = ?
          WHERE id = ? AND actual_start IS NULL`,
        [todayISO(), ticket.milestone_id]
      );
    } else if (ticket.kind === 'rework') {
      const milestone = await queryOne(
        `SELECT id, project_id, department, milestone_label FROM milestones WHERE id = ? AND ${MILESTONE_DONE}`,
        [ticket.milestone_id]
      );
      if (milestone) {
        await execute(
          `UPDATE milestones SET actual_end = NULL, status = 'in_progress', reopened_at = CURRENT_TIMESTAMP WHERE id = ?`,
          [milestone.id]
        );
        // This milestone was closed once before — if that closure already fired a handoff
        // downstream (lib/tickets.js fireHandoff, source_key = 'handoff:<this milestone id>'),
        // whoever received it needs to know the work they were told was ready, isn't anymore.
        const firedHandoff = await queryOne(
          `SELECT to_department FROM tickets WHERE source_key = ?`,
          [`handoff:${milestone.id}`]
        );
        if (firedHandoff) {
          await notifyDepartment(firedHandoff.to_department, {
            kind: 'reopened',
            ticket_id: ticket.id,
            title: `${milestone.milestone_label} reopened`,
            body: `${milestone.milestone_label} in ${milestone.department} was reopened for rework — it's no longer finished.`,
          }, { except: user.id });
        }
      }
    }
  }

  return NextResponse.json({ ok: true });
}
