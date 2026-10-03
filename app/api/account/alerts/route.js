// Settings → Alerts: the signed-in person's alert email, photo and per-alert choices
// (lib/notification-catalog.mjs). GET returns what this person can see (their departments; Heads-only
// alerts for Heads; Management for PMs). PUT saves one alert ({ kind, in_app, email }) or a whole
// group's email choice ({ kinds: [...], email }).
import { NextResponse } from 'next/server';
import { queryAll, queryOne, execute } from '@/lib/db';
import { getFreshSessionUser, isInternal, isPM, isDepartmentHead, parseDepartments } from '@/lib/auth';
import { visibleGroups, OTHER_KIND, EMAIL_MODES } from '@/lib/notification-catalog.mjs';

function groupsFor(user) {
  return visibleGroups({ departments: parseDepartments(user.departments), isPm: isPM(user), isHeadOf: d => isDepartmentHead(user, d) });
}
const allowedKinds = user => new Set([OTHER_KIND, ...groupsFor(user).flatMap(g => g.alerts.map(a => a.kind))]);

export async function GET() {
  const user = await getFreshSessionUser();
  if (!user || !isInternal(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const me = await queryOne('SELECT notify_email, avatar_key FROM users WHERE id = ?', [user.id]);
  const prefs = await queryAll('SELECT kind, in_app, email FROM notification_prefs WHERE user_id = ?', [user.id]);
  return NextResponse.json({
    notify_email: me?.notify_email || '',
    has_avatar: !!me?.avatar_key,
    groups: groupsFor(user),
    prefs: Object.fromEntries(prefs.map(p => [p.kind, { in_app: !!p.in_app, email: p.email }])),
    email_ready: !!(process.env.ALERTS_SMTP_USER && process.env.ALERTS_SMTP_PASS),
  });
}

export async function PUT(req) {
  const user = await getFreshSessionUser();
  if (!user || !isInternal(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const b = await req.json();
  if ('notify_email' in b) {
    const email = String(b.notify_email || '').trim();
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return NextResponse.json({ error: 'Not a valid email address' }, { status: 400 });
    await execute('UPDATE users SET notify_email = ? WHERE id = ?', [email || null, user.id]);
    return NextResponse.json({ ok: true });
  }
  const allowed = allowedKinds(user);
  const kinds = Array.isArray(b.kinds) ? b.kinds : [b.kind];
  if (!kinds.length || kinds.some(k => !allowed.has(k))) return NextResponse.json({ error: 'Unknown alert' }, { status: 400 });
  if (b.email !== undefined && !EMAIL_MODES.includes(b.email)) return NextResponse.json({ error: 'Unknown email choice' }, { status: 400 });
  for (const kind of kinds) {
    // Upsert, keeping whichever of the two fields wasn't sent.
    await execute(
      `INSERT INTO notification_prefs (user_id, kind, in_app, email) VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id, kind) DO UPDATE SET
         in_app = CASE WHEN ? IS NULL THEN in_app ELSE excluded.in_app END,
         email = CASE WHEN ? IS NULL THEN email ELSE excluded.email END,
         updated_at = CURRENT_TIMESTAMP`,
      [user.id, kind, b.in_app === undefined ? 1 : (b.in_app ? 1 : 0), b.email ?? 'off',
       b.in_app === undefined ? null : 1, b.email === undefined ? null : 1]);
  }
  return NextResponse.json({ ok: true });
}
