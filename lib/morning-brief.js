// lib/morning-brief.js — sends the morning brief (lib/morning-brief.mjs) by email, once per IST day
// after 8 AM, to PMs who switched on "Morning brief" in Settings → Alerts. Same sender, test/live
// switch and mail log as every other staff alert. WhatsApp: add a template send here once a Meta
// account and an approved template exist.
import { queryAll, getAppSetting, setAppSetting } from './db';
import { getExecutiveSummary, getExecutiveBusiness } from './data';
import { sendMail, MAIL_FOOTER } from './mail';
import { appUrl } from './app-url';
import { buildBrief } from './morning-brief.mjs';

export async function sweepMorningBrief() {
  const ist = new Date(Date.now() + 5.5 * 3600e3);
  if (ist.getUTCHours() < 8) return { sent: 0, skipped: 'before 8 AM IST' };
  const today = ist.toISOString().slice(0, 10);
  if ((await getAppSetting('morning_brief_last_run')) === today) return { sent: 0, skipped: 'already sent today' };
  // ponytail: claimed before sending so two bell polls can't both send; a failed send is not
  // retried that day (it is in the mail log). Per-recipient retry if that ever matters.
  await setAppSetting('morning_brief_last_run', today);

  const people = await queryAll(
    `SELECT u.notify_email FROM users u
       JOIN notification_prefs np ON np.user_id = u.id AND np.kind = 'morning_brief' AND np.email IN ('instant', 'daily')
      WHERE u.active = 1 AND u.role IN ('admin', 'manager', 'executive') AND u.notify_email IS NOT NULL AND u.notify_email != ''`);
  if (!people.length) return { sent: 0 };

  const [{ kpi, topRisks, forecast }, biz] = await Promise.all([getExecutiveSummary(null), getExecutiveBusiness(null)]);
  const { subject, text } = buildBrief({ kpi, topRisks, forecast, biz, today, link: appUrl('/executive') });
  let sent = 0;
  for (const p of people) {
    try {
      await sendMail({ to: p.notify_email, subject, text: text + MAIL_FOOTER, kind: 'morning_brief', purpose: 'alerts' });
      sent++;
    } catch (err) { console.error(`[mail] morning brief to ${p.notify_email} failed: ${err.message}`); }
  }
  return { sent };
}
