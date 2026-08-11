import { NextResponse } from 'next/server';
import { execute } from '@/lib/db';
import { getSessionUser, requireDepartment, canAccessDepartment, isPM } from '@/lib/auth';
import { getJobApplicants } from '@/lib/data';

export async function GET(req) {
  const user = getSessionUser();
  if (!isPM(user) && !canAccessDepartment(user, 'HR')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const jobOpeningId = new URL(req.url).searchParams.get('job_opening_id');
  return NextResponse.json(await getJobApplicants(jobOpeningId));
}

export async function POST(req) {
  const user = getSessionUser();
  const denied = requireDepartment(user, 'HR');
  if (denied) return denied;
  const b = await req.json();
  if (!b.job_opening_id) return NextResponse.json({ error: 'job_opening_id is required' }, { status: 400 });
  const name = String(b.name || '').trim();
  if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 });

  const { lastId } = await execute(
    'INSERT INTO job_applicants (job_opening_id, name, email, phone, resume_url, source, notes) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [b.job_opening_id, name, b.email || null, b.phone || null, b.resume_url || null, b.source || null, b.notes || null]
  );
  return NextResponse.json({ id: Number(lastId) });
}
