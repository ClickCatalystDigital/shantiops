// How many visits a project is expected to need (default 4) — drives "N remaining".
import { NextResponse } from 'next/server';
import { execute } from '@/lib/db';
import { getFreshSessionUser, canAccessDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';

export async function PATCH(req) {
  const user = await getFreshSessionUser();
  if (!user || !canAccessDepartment(user, 'Installation')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const denied = await requireAction(user, 'Installation', 'installation.visit.write');
  if (denied) return denied;
  const b = await req.json();
  const n = Math.floor(Number(b.planned_visits));
  if (!b.project_id || !(n >= 0 && n <= 50)) return NextResponse.json({ error: 'Planned visits must be 0-50' }, { status: 400 });
  await execute('UPDATE projects SET installation_planned_visits = ? WHERE id = ?', [n, b.project_id]);
  return NextResponse.json({ ok: true });
}
