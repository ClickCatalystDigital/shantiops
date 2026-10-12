// "Send me my morning brief now" — the signed-in person's own briefs, to their own alert email,
// ignoring the once-a-day rule. Body { to } lets an admin send them to another address for checking.
import { NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import { getFreshSessionUser, isInternal } from '@/lib/auth';
import { sendBriefsTo } from '@/lib/morning-brief';

export async function POST(req) {
  const user = await getFreshSessionUser();
  if (!isInternal(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const b = await req.json().catch(() => ({}));
  const row = await queryOne('SELECT id, role, departments, notify_email FROM users WHERE id = ?', [user.id]);
  const to = (user.role === 'admin' && b.to) || row.notify_email;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(to || ''))) return NextResponse.json({ error: 'Set your alert email in Settings → Alerts first' }, { status: 400 });
  return NextResponse.json(await sendBriefsTo({ ...row, notify_email: to }));
}
