// lib/notify.js — notification fan-out + the handoff rule's write side. Formerly lib/tickets.js:
// closing a milestone used to create a `tickets` row as an intermediate object; it now fires a
// plain notification directly, with the milestone itself carrying whatever state matters (see the
// `tickets` table comment in lib/db.js for why the table still exists but nothing writes to it).
import { queryAll, queryOne, execute } from './db';
import { parseDepartments, isDepartmentHead, parseProjectIds } from './auth';
import { handoffTarget } from './handoff.mjs';
import { sendMail, MAIL_FOOTER } from './mail';
import { prefKey, resolvePref } from './notification-catalog.mjs';
import { appUrl } from './app-url';

// One notification row per recipient (see the notifications table comment in lib/db.js for why
// fan-out over an events+reads join). INSERT OR IGNORE so a repeat with the same dedupe_key
// (Phase 2's overdue sweep, or a re-fired handoff) is a silent no-op rather than a duplicate row.
//
// Customer Portal status-update email (2026-08-23): every existing customer-facing notification
// (drawing_shared, etc.) already flows through this one function — so a customer who's opted into
// email (customers.portal_enabled) gets emailed here too, for free, with no second "status update"
// event system to keep in sync. Best-effort: a real notification row always lands regardless of
// whether email is configured/succeeds — see lib/mail.js for why sending can still fail today.
//
// `isCustomerRecipient` is an opt-in hint from callers that already know the recipient is a
// customer (e.g. lib/calc.js's sweepDrawingNotifications, which queries role='customer' users
// itself) — this function does NOT look it up on its own. notifyDepartment/notifyPMs, the two call
// sites behind the vast majority of notification traffic, are exclusively internal users; without
// this guard every one of those would pay an extra remote-DB round-trip checking a `customers` row
// that can never match, on a database where a single round-trip has been observed to take 10s of
// seconds under load this session.
export async function notifyUser(userId, { kind, milestone_id = null, task_id = null, project_id = null, title, body = null, dedupe_key = null, isCustomerRecipient = false }) {
  // Staff alert settings (Settings → Alerts): bell off = the row is still written (dedupe, daily
  // summary) but muted, so the bell never shows it; email instant = sent right after. Customers keep
  // their own portal email rule below.
  const pref = isCustomerRecipient ? null : await queryOne(
    `SELECT u.notify_email, np.in_app, np.email FROM users u
       LEFT JOIN notification_prefs np ON np.user_id = u.id AND np.kind = ? WHERE u.id = ?`, [prefKey(kind), userId]);
  const p = resolvePref(pref?.email == null ? null : pref);
  const { changes } = await execute(
    `INSERT OR IGNORE INTO notifications (user_id, kind, milestone_id, task_id, project_id, title, body, dedupe_key, muted)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [userId, kind, milestone_id, task_id, project_id, title, body, dedupe_key, p.in_app ? 0 : 1]
  );
  if (changes && p.email === 'instant' && pref?.notify_email) {
    sendMail({ to: pref.notify_email, subject: title, text: alertText({ title, body, project_id }), kind: 'alert', purpose: 'alerts' })
      .catch(err => console.error(`[mail] alert to ${pref.notify_email} failed: ${err.message}`));
  }
  if (changes && isCustomerRecipient) {
    const cust = await queryOne('SELECT email FROM customers WHERE portal_user_id = ? AND portal_enabled = 1', [userId]);
    if (cust?.email) {
      // Failures are recorded in mail_log by sendMail; the in-app notification above already landed.
      const proj = project_id ? await queryOne('SELECT company FROM projects WHERE id = ?', [project_id]) : null;
      sendMail({ to: cust.email, subject: title, text: body || title, company: proj?.company || null, kind: 'status_update' })
        .catch(err => console.error(`[mail] status-update email to ${cust.email} failed: ${err.message}`));
    }
  }
  return changes;
}

// Every customer who owns this project (users.project_ids CSV match — same pattern
// lib/calc.js's sweepDrawingNotifications already used before this was extracted). The one real
// choke point for "a document just became visible in the portal" events — QC document sharing,
// invoice issuance — so a future document type reuses this instead of re-deriving the lookup.
export async function notifyProjectCustomers(projectId, note) {
  const customers = await queryAll(
    "SELECT id, project_ids FROM users WHERE role = 'customer' AND active = 1 AND pending = 0");
  const recipients = customers.filter(u => parseProjectIds(u.project_ids).includes(String(projectId)));
  let n = 0;
  for (const u of recipients) n += await notifyUser(u.id, { ...note, project_id: projectId, isCustomerRecipient: true });
  return n;
}

// Everyone whose departments CSV contains `department`. Matched in JS, not a SQL LIKE — same idiom
// as getFunctionalHeads(), and LIKE '%Design%' would also match a future 'Design Review'.
//
// PMs are excluded by construction: their departments column is NULL. Deliberate — they get the
// Operations page for oversight, but a chime on every handoff on every project trains them to
// ignore the bell. Granting a PM a department opts them in with zero code change.
export async function notifyDepartment(department, note, { except = null, assignedTo = null, actionKey = null } = {}) {
  const users = await queryAll(
    `SELECT id, username, departments, role, department_roles FROM users
      WHERE active = 1 AND pending = 0 AND departments IS NOT NULL AND departments != ''`
  );
  let recipients = users.filter(u => parseDepartments(u.departments).includes(department));

  // Narrow to Heads when this notification is specifically about a Head-gated action (§5i
  // Responsibility model + Action Permissions) — a Member notified about something only a Head
  // can act on is just noise, they'd get a 403 trying. Only narrows the department-derived list;
  // an explicit assignedTo below still always reaches that person. An action with no
  // action_permissions row (or actionKey omitted) defaults to open, same as canPerformAction.
  if (actionKey) {
    const perm = await queryOne(
      'SELECT requires_head FROM action_permissions WHERE department = ? AND action_key = ?',
      [department, actionKey]
    );
    if (perm?.requires_head) recipients = recipients.filter(u => isDepartmentHead(u, department));
  }

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

// Unconditional Head-only fan-out, distinct from notifyDepartment's actionKey narrowing (which
// only narrows when a matching action_permissions row has requires_head — and Design's own
// approve/review gates are deliberately kept out of that table, §5i, so actionKey can't be used for
// them). For an event that should only ever reach whoever can act on it, with no configurable
// "make this open to everyone" escape hatch.
export async function notifyDepartmentHeads(department, note) {
  const users = await queryAll(
    `SELECT id, username, departments, role, department_roles FROM users
      WHERE active = 1 AND pending = 0 AND departments IS NOT NULL AND departments != ''`
  );
  const recipients = users.filter(u => parseDepartments(u.departments).includes(department) && isDepartmentHead(u, department));
  let n = 0;
  for (const u of recipients) n += await notifyUser(u.id, note);
  return n;
}

// PM tier deliberately has no `departments` value (see notifyDepartment's comment above) so a PM
// never gets pulled into the department-handoff noise. This is the explicit exception for the
// handful of PM-relevant commercial events (SO created, SO converted to Project) — used sparingly
// on purpose, not a way to route around that design.
export async function notifyPMs(note, { except = null } = {}) {
  const users = await queryAll(
    `SELECT id FROM users WHERE active = 1 AND pending = 0 AND role IN ('admin', 'manager', 'executive')`
  );
  let n = 0;
  for (const u of users) {
    if (u.id === except) continue;
    n += await notifyUser(u.id, note);
  }
  return n;
}

// Fired from the milestones PATCH when a milestone becomes done. Notification-only now — no ticket
// row. Idempotent via the notification's own dedupe_key, keyed on reopen_count so a
// reopen→redo→reclose cycle notifies downstream again (the old ticket-based flow couldn't: its
// source_key was UNIQUE forever, see SYSTEM.md §3b's "known limitation"). Must never throw into the
// caller — the milestone save is the user's real intent and is worth more than a notification (the
// caller wraps this in a try/catch regardless).
export async function fireHandoff(milestoneId, actor) {
  const rows = await queryAll(
    `SELECT id, project_id, sort_order, department, milestone_label, planned_end, reopen_count
       FROM milestones WHERE project_id = (SELECT project_id FROM milestones WHERE id = ?)`,
    [milestoneId]
  );
  const closed = rows.find(r => r.id === Number(milestoneId));
  const next = closed && handoffTarget(rows, closed);
  if (!next) return;

  const project = await queryOne('SELECT project_no FROM projects WHERE id = ?', [closed.project_id]);
  await notifyDepartment(next.department, {
    kind: 'handoff',
    milestone_id: next.id,
    title: `Handoff from ${closed.department}`,
    body: `${project?.project_no || ''} · ${next.milestone_label}`,
    dedupe_key: `handoff:${closed.id}:${closed.reopen_count}`,
  }, { except: null });
}

// Plain-text body of an alert email: the message, a link back into the app, the footer.
function alertText({ title, body, project_id }) {
  const link = appUrl(project_id ? `/projects/${project_id}` : '/notifications');
  return [title, body, link && `Open: ${link}`].filter(Boolean).join('\n\n') + MAIL_FOOTER;
}

// Daily summary: for each person who chose "Daily" on any alert, one email listing those alerts
// since their last summary (at most once per IST day). Called from the daily reminders cron and the
// hourly backup path in getNotifications.
export async function sweepAlertDigests() {
  const ist = new Date(Date.now() + 5.5 * 3600e3);
  if (ist.getUTCHours() < 8) return { sent: 0, skipped: 'before 8 AM IST' }; // a morning summary
  const istToday = ist.toISOString().slice(0, 10);
  const people = await queryAll(
    `SELECT DISTINCT u.id, u.notify_email, u.last_digest_at FROM users u JOIN notification_prefs np ON np.user_id = u.id
      WHERE np.email = 'daily' AND u.active = 1 AND u.notify_email IS NOT NULL AND u.notify_email != ''
        AND (u.last_digest_at IS NULL OR DATE(u.last_digest_at, '+330 minutes') < ?)`, [istToday]);
  let sent = 0;
  for (const u of people) {
    const daily = new Set((await queryAll("SELECT kind FROM notification_prefs WHERE user_id = ? AND email = 'daily'", [u.id])).map(r => r.kind));
    const since = u.last_digest_at || new Date(Date.now() - 24 * 3600e3).toISOString().slice(0, 19).replace('T', ' ');
    const rows = (await queryAll(
      'SELECT kind, title, body, project_id, created_at FROM notifications WHERE user_id = ? AND created_at > ? ORDER BY id', [u.id, since]))
      .filter(r => daily.has(prefKey(r.kind)));
    await execute('UPDATE users SET last_digest_at = CURRENT_TIMESTAMP WHERE id = ?', [u.id]);
    if (!rows.length) continue;
    const lines = rows.map(r => `• ${r.title}${r.body ? ` — ${r.body}` : ''}`);
    const link = appUrl('/notifications');
    try {
      await sendMail({ to: u.notify_email, subject: `Your SB Ops summary — ${rows.length} alert${rows.length === 1 ? '' : 's'}`,
        text: [`Alerts since your last summary:`, lines.join('\n'), link && `Open: ${link}`].filter(Boolean).join('\n\n') + MAIL_FOOTER,
        kind: 'alert_digest', purpose: 'alerts' });
      sent++;
    } catch (err) { console.error(`[mail] digest to ${u.notify_email} failed: ${err.message}`); }
  }
  return { sent };
}
