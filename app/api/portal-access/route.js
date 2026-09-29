// GET — customers that have (or could have) a Customer Portal login: those with a project or an
// existing login. Sales Head / PM only. Status: not_enabled | invited (setup link not used yet) | active.
import { NextResponse } from 'next/server';
import { queryAll } from '@/lib/db';
import { getFreshSessionUser, isDepartmentHead } from '@/lib/auth';

export async function GET(req) {
  const user = await getFreshSessionUser();
  if (!user || !isDepartmentHead(user, 'Sales')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const q = (new URL(req.url).searchParams.get('q') || '').trim().toLowerCase();
  const rows = await queryAll(
    `SELECT c.id, c.name, c.email, c.portal_enabled, c.portal_user_id, c.initial_email_sent_at,
            u.username, u.last_login, u.password_setup_token IS NOT NULL AS setup_pending,
            (SELECT COUNT(*) FROM projects p WHERE p.customer_id = c.id) AS project_count
       FROM customers c LEFT JOIN users u ON u.id = c.portal_user_id
      WHERE c.active = 1 AND (c.portal_user_id IS NOT NULL OR EXISTS (SELECT 1 FROM projects p WHERE p.customer_id = c.id))
      ORDER BY c.name`);
  const list = rows
    .filter(r => !q || r.name.toLowerCase().includes(q) || (r.username || '').includes(q))
    .map(r => ({ ...r, status: !r.portal_user_id ? 'not_enabled' : r.setup_pending ? 'invited' : 'active' }));
  return NextResponse.json(list.slice(0, 200));
}
