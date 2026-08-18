// app/api/job-offers/[id]/route.js — Recruitment leftover: status transitions for an offer
// (draft -> sent -> accepted/declined). Doesn't auto-hire on accept — hiring stays its own
// explicit PATCH /api/job-applicants/[id] action, unchanged, so accepting an offer never silently
// short-circuits the existing hire flow.
import { NextResponse } from 'next/server';
import { execute } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';

const STATUSES = ['draft', 'sent', 'accepted', 'declined'];

export async function PATCH(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'HR');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'HR', 'hr.offer.decide');
  if (actionDenied) return actionDenied;
  const b = await req.json();
  if (!STATUSES.includes(b.status)) return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
  await execute('UPDATE job_offers SET status = ? WHERE id = ?', [b.status, params.id]);
  return NextResponse.json({ ok: true });
}
