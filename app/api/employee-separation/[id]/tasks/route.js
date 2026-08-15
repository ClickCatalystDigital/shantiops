// app/api/employee-separation/[id]/tasks/route.js — HR core leftover: add an ad-hoc task to an
// in-progress separation checklist (previously only toggle pending/done existed).
import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';

export async function POST(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'HR');
  if (denied) return denied;
  const b = await req.json();
  const task = String(b.task || '').trim();
  if (!task) return NextResponse.json({ error: 'Task is required' }, { status: 400 });
  const maxOrder = await queryOne('SELECT COALESCE(MAX(sort_order), -1) AS n FROM separation_tasks WHERE separation_id = ?', [params.id]);
  const { lastId } = await execute(
    'INSERT INTO separation_tasks (separation_id, task, assigned_to, sort_order) VALUES (?, ?, ?, ?)',
    [params.id, task, b.assigned_to || null, maxOrder.n + 1]
  );
  return NextResponse.json({ id: Number(lastId) });
}
