// app/api/job-offers/route.js — V3_CHANGES.md §12 Phase 4. offer_note is free-text reference
// only, never a payroll figure (HARD BOUNDARY).
import { NextResponse } from 'next/server';
import { execute, queryAll } from '@/lib/db';
import { getFreshSessionUser, requireDepartment, canAccessDepartment, isPM } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';

export async function GET(req) {
  const user = await getFreshSessionUser();
  if (!isPM(user) && !canAccessDepartment(user, 'HR')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const applicantId = new URL(req.url).searchParams.get('applicant_id');
  if (!applicantId) return NextResponse.json({ error: 'applicant_id is required' }, { status: 400 });
  return NextResponse.json(await queryAll('SELECT * FROM job_offers WHERE applicant_id = ? ORDER BY created_at DESC', [applicantId]));
}

export async function POST(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'HR');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'HR', 'hr.recruitment.write');
  if (actionDenied) return actionDenied;
  const b = await req.json();
  if (!b.applicant_id) return NextResponse.json({ error: 'applicant_id is required' }, { status: 400 });
  const { lastId } = await execute(
    'INSERT INTO job_offers (applicant_id, designation_id, offer_note) VALUES (?, ?, ?)',
    [b.applicant_id, b.designation_id || null, b.offer_note || null]
  );
  await execute("UPDATE job_applicants SET status = 'offered', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [b.applicant_id]);
  return NextResponse.json({ id: Number(lastId) });
}
