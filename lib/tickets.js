// lib/tickets.js — ticket creation + notification fan-out. The write half of the tickets
// feature; reads live in lib/data.js like everything else in this repo.
import { queryAll, queryOne, execute } from './db';
import { parseDepartments } from './auth';
import { handoffTarget } from './handoff.mjs';

// One notification row per recipient (see the notifications table comment in lib/db.js for why
// fan-out over an events+reads join). INSERT OR IGNORE so a repeat with the same dedupe_key
// (Phase 2's overdue sweep) is a silent no-op rather than a duplicate row.
export async function notifyUser(userId, { kind, ticket_id = null, title, body = null, dedupe_key = null }) {
  const { changes } = await execute(
    `INSERT OR IGNORE INTO notifications (user_id, kind, ticket_id, title, body, dedupe_key)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [userId, kind, ticket_id, title, body, dedupe_key]
  );
  return changes;
}

// Everyone whose departments CSV contains `department`. Matched in JS, not a SQL LIKE — same idiom
// as getFunctionalHeads(), and LIKE '%Design%' would also match a future 'Design Review'.
//
// PMs are excluded by construction: their departments column is NULL. Deliberate — they get the
// /tickets page for oversight, but a chime on every handoff on every project trains them to ignore
// the bell. Granting a PM a department opts them in with zero code change.
export async function notifyDepartment(department, note, { except = null, assignedTo = null } = {}) {
  const users = await queryAll(
    `SELECT id, username, departments FROM users
      WHERE active = 1 AND pending = 0 AND departments IS NOT NULL AND departments != ''`
  );
  const recipients = users.filter(u => parseDepartments(u.departments).includes(department));
  // A PM assigning across department lines still reaches the assignee even if they're not
  // (yet) granted that department.
  if (assignedTo && !recipients.some(u => u.username === assignedTo)) {
    const extra = users.find(u => u.username === assignedTo);
    if (extra) recipients.push(extra);
  }
  let n = 0;
  for (const u of recipients) {
    if (u.id === except) continue;                     // never chime at yourself
    n += await notifyUser(u.id, { ...note, kind: u.username === assignedTo ? 'assigned' : note.kind });
  }
  return n;
}

// Fired from the milestones PATCH when a milestone becomes done. Idempotent via
// tickets.source_key. Must never throw into the caller — the milestone save is the user's real
// intent and is worth more than a notification (the caller wraps this in a try/catch regardless).
export async function fireHandoff(milestoneId, actor) {
  const rows = await queryAll(
    `SELECT id, project_id, sort_order, department, milestone_label, planned_end
       FROM milestones WHERE project_id = (SELECT project_id FROM milestones WHERE id = ?)`,
    [milestoneId]
  );
  const closed = rows.find(r => r.id === Number(milestoneId));
  const next = closed && handoffTarget(rows, closed);
  if (!next) return null;

  const project = await queryOne('SELECT project_no FROM projects WHERE id = ?', [closed.project_id]);
  // milestone_id points at the NEXT milestone — the work being handed over, which is what the
  // ticket subtitle shows ("SB-1018 · from QC · Refractory"). The closed one is named in the body.
  const { changes, lastId } = await execute(
    `INSERT OR IGNORE INTO tickets
       (source_key, kind, project_id, milestone_id, from_department, to_department,
        title, body, due_date, created_by)
     VALUES (?, 'handoff', ?, ?, ?, ?, ?, ?, ?, ?)`,
    [`handoff:${closed.id}`, closed.project_id, next.id, closed.department, next.department,
     `${next.milestone_label} — ready to start`,
     `${closed.milestone_label} closed in ${closed.department}.`,
     next.planned_end || null, actor]
  );
  if (!changes) return null;              // already fired (reopen→reclose): lastId is stale, don't use it
  const ticketId = Number(lastId);
  await notifyDepartment(next.department, {
    kind: 'handoff',
    ticket_id: ticketId,
    title: `Handoff from ${closed.department}`,
    body: `${project?.project_no || ''} · ${next.milestone_label}`,
  });
  return ticketId;
}
