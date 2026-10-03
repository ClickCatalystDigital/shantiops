// lib/morning-brief.js — sends the morning briefs (lib/morning-brief.mjs) by email, once per IST day
// after 8 AM, to people who switched on "Morning brief" in Settings → Alerts:
//   executive → Executive brief · manager → Project Manager brief · department people → one brief
//   per department they hold · admin → every brief (so one person can check them all).
// Same sender, test/live switch and mail log as every other staff alert. WhatsApp: add a template
// send here once a Meta account and an approved template exist.
import { queryAll, getAppSetting, setAppSetting } from './db';
import { getExecutiveSummary, getExecutiveBusiness } from './data';
import { parseDepartments } from './auth';
import { DEPARTMENTS } from './milestones';
import { sendMail, MAIL_FOOTER } from './mail';
import { appUrl } from './app-url';
import { todayISO } from './date';
import { executiveBrief, pmBrief, departmentBrief, renderBrief } from './morning-brief.mjs';

// Every brief, built once per run. Department work = open milestones of active orders (split-order
// units left out, their master carries the schedule) plus the department's open tasks.
async function buildAll(today) {
  const weekEnd = new Date(Date.parse(`${today}T00:00:00Z`) + 7 * 864e5).toISOString().slice(0, 10);
  const [{ kpi, topRisks, forecast }, biz, ms, tasks] = await Promise.all([
    getExecutiveSummary(null), getExecutiveBusiness(null),
    queryAll(
      `SELECT m.department, m.milestone_label AS label, m.planned_end, p.project_no FROM milestones m JOIN projects p ON p.id = m.project_id
        WHERE p.status = 'active' AND p.is_system = 0 AND p.master_project_id IS NULL
          AND m.status != 'done' AND m.actual_end IS NULL AND m.planned_end IS NOT NULL AND m.planned_end <= ? ORDER BY m.planned_end`, [weekEnd]),
    queryAll("SELECT department, COUNT(*) AS n FROM tasks WHERE status != 'done' GROUP BY department"),
  ]);
  const common = { kpi, topRisks, forecast, biz, today };
  const dept = {};
  for (const d of DEPARTMENTS) {
    const mine = ms.filter(m => m.department === d);
    dept[d] = departmentBrief({ department: d, today, tasks: Number(tasks.find(t => t.department === d)?.n || 0),
      overdue: mine.filter(m => m.planned_end < today), due: mine.filter(m => m.planned_end >= today) });
  }
  return { executive: executiveBrief(common), pm: pmBrief(common), dept };
}

// Which briefs one person gets. Empty department briefs are skipped (nothing to act on).
function briefsFor(user, all) {
  const depts = list => list.map(d => all.dept[d]).filter(b => b && !b.empty);
  if (user.role === 'admin') return [all.executive, all.pm, ...depts(DEPARTMENTS)];
  if (user.role === 'executive') return [all.executive];
  if (user.role === 'manager') return [all.pm];
  return depts(parseDepartments(user.departments));
}

// Sends this person's briefs now. Used by the daily sweep and by the "send me a test" route.
export async function sendBriefsTo(user, all = null) {
  const today = todayISO();
  const briefs = briefsFor(user, all || await buildAll(today));
  let sent = 0;
  for (const b of briefs) {
    const mail = renderBrief(b, { today, link: appUrl(b.path), footer: MAIL_FOOTER });
    try { await sendMail({ to: user.notify_email, ...mail, kind: 'morning_brief', purpose: 'alerts' }); sent++; }
    catch (err) { console.error(`[mail] morning brief to ${user.notify_email} failed: ${err.message}`); }
  }
  return { briefs: briefs.length, sent };
}

export async function sweepMorningBrief() {
  const ist = new Date(Date.now() + 5.5 * 3600e3);
  if (ist.getUTCHours() < 8) return { sent: 0, skipped: 'before 8 AM IST' };
  const today = ist.toISOString().slice(0, 10);
  if ((await getAppSetting('morning_brief_last_run')) === today) return { sent: 0, skipped: 'already sent today' };
  // ponytail: claimed before sending so two bell polls can't both send; a failed send is not
  // retried that day (it is in the mail log). Per-recipient retry if that ever matters.
  await setAppSetting('morning_brief_last_run', today);

  const people = await queryAll(
    `SELECT u.id, u.role, u.departments, u.notify_email FROM users u
       JOIN notification_prefs np ON np.user_id = u.id AND np.kind = 'morning_brief' AND np.email IN ('instant', 'daily')
      WHERE u.active = 1 AND u.role IN ('admin', 'manager', 'executive', 'operator') AND u.notify_email IS NOT NULL AND u.notify_email != ''`);
  if (!people.length) return { sent: 0 };
  const all = await buildAll(today);
  let sent = 0;
  for (const p of people) sent += (await sendBriefsTo(p, all)).sent;
  return { sent };
}
