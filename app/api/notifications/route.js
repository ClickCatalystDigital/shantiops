// Nav bell backend — polled every ~20s by components/NotificationBell.jsx. Kept to two indexed
// scans (see getNotifications in lib/data.js) since this runs on every page for every logged-in user.
import { NextResponse } from 'next/server';
import { execute } from '@/lib/db';
import { getFreshSessionUser } from '@/lib/auth';
import { getNotifications } from '@/lib/data';

export async function GET() {
  const user = await getFreshSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json(await getNotifications(user.id));
}

// {id} marks one read; {} (or no body) marks everything read. Returns the fresh payload so the
// bell needs no follow-up GET.
export async function PATCH(req) {
  const user = await getFreshSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  if (b.id) {
    await execute('UPDATE notifications SET read_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?', [b.id, user.id]);
  } else {
    await execute('UPDATE notifications SET read_at = CURRENT_TIMESTAMP WHERE user_id = ? AND read_at IS NULL', [user.id]);
  }
  return NextResponse.json(await getNotifications(user.id));
}
