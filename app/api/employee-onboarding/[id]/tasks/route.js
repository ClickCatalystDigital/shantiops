// app/api/employee-onboarding/[id]/tasks/route.js — HR core leftover: add an ad-hoc task to an
// in-progress onboarding checklist (previously only toggle pending/done existed).
import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getSessionUser, requireDepartment } from '@/lib/auth';

export async function POST(req, { params }) {
  const user = getSessionUser();
  const denied = requireDepartment(user, 'HR');
  if (denied) return denied;
  const b = await req.json();
  const task = String(b.task || '').trim();
  if (!task) return NextResponse.json({ error: 'Task is required' }, { status: 400 });
  const maxOrder = await queryOne('SELECT COALESCE(MAX(sort_order), -1) AS n FROM onboarding_tasks WHERE onboarding_id = ?', [params.id]);
  const { lastId } = await execute(
    'INSERT INTO onboarding_tasks (onboarding_id, task, assigned_to, sort_order) VALUES (?, ?, ?, ?)',
    [params.id, task, b.assigned_to || null, maxOrder.n + 1]
  );
  return NextResponse.json({ id: Number(lastId) });
}
