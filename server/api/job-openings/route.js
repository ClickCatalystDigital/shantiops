import { NextResponse } from 'next/server';
import { execute } from '@/lib/db';
import { getFreshSessionUser, requireDepartment, canAccessDepartment, isPM } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { getJobOpenings } from '@/lib/data';

export async function GET() {
  const user = await getFreshSessionUser();
  if (!isPM(user) && !canAccessDepartment(user, 'HR')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  return NextResponse.json(await getJobOpenings());
}

export async function POST(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'HR');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'HR', 'hr.recruitment.write');
  if (actionDenied) return actionDenied;
  const b = await req.json();
  const title = String(b.title || '').trim();
  if (!title) return NextResponse.json({ error: 'Title is required' }, { status: 400 });
  const { lastId } = await execute(
    'INSERT INTO job_openings (title, department, employment_type_id, description, opened_by) VALUES (?, ?, ?, ?, ?)',
    [title, b.department || null, b.employment_type_id || null, b.description || null, user.username]
  );
  return NextResponse.json({ id: Number(lastId) });
}
