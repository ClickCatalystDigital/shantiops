// Purpose-of-visit suggestions: the caller's own site-visit descriptions that match what they typed.
import { NextResponse } from 'next/server';
import { queryAll } from '@/lib/db';
import { getFreshSessionUser, canAccessDepartment } from '@/lib/auth';

export async function GET(req) {
  const user = await getFreshSessionUser();
  if (!user || !canAccessDepartment(user, 'Installation')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const q = (new URL(req.url).searchParams.get('q') || '').trim().toLowerCase();
  const rows = await queryAll(
    `SELECT DISTINCT description FROM installation_visits
      WHERE (',' || COALESCE(visited_by,'') || ',' LIKE ? OR created_by = ?) ${q ? 'AND LOWER(description) LIKE ?' : ''}
      ORDER BY id DESC LIMIT 15`,
    q ? [`%,${user.username},%`, user.username, `%${q}%`] : [`%,${user.username},%`, user.username]);
  return NextResponse.json(rows.map(r => r.description));
}
