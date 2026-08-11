import { NextResponse } from 'next/server';
import { execute, queryAll } from '@/lib/db';
import { getSessionUser, requireDepartment, canAccessDepartment, isPM } from '@/lib/auth';

export async function GET(req) {
  const user = getSessionUser();
  if (!isPM(user) && !canAccessDepartment(user, 'HR')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const applicantId = new URL(req.url).searchParams.get('applicant_id');
  if (!applicantId) return NextResponse.json({ error: 'applicant_id is required' }, { status: 400 });
  return NextResponse.json(await queryAll('SELECT * FROM interviews WHERE applicant_id = ? ORDER BY scheduled_at', [applicantId]));
}

export async function POST(req) {
  const user = getSessionUser();
  const denied = requireDepartment(user, 'HR');
  if (denied) return denied;
  const b = await req.json();
  if (!b.applicant_id) return NextResponse.json({ error: 'applicant_id is required' }, { status: 400 });
  const { lastId } = await execute(
    'INSERT INTO interviews (applicant_id, scheduled_at, interviewer) VALUES (?, ?, ?)',
    [b.applicant_id, b.scheduled_at || null, b.interviewer || null]
  );
  await execute("UPDATE job_applicants SET status = 'interview', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status IN ('applied','screening')", [b.applicant_id]);
  return NextResponse.json({ id: Number(lastId) });
}
