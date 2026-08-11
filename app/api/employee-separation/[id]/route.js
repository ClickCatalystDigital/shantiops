// app/api/employee-separation/[id]/route.js — V3_CHANGES.md §13. Exit-detail fields on an
// already-started separation (reason was already settable at POST /api/employee-separation; the
// rest of the exit structure — encashment, exit interview, relieving date — is filled in over the
// life of the separation, same "editable header" shape employee_separation already had for reason).
import { NextResponse } from 'next/server';
import { execute } from '@/lib/db';
import { getSessionUser, requireDepartment } from '@/lib/auth';
import { audit } from '@/lib/usb';

export async function PATCH(req, { params }) {
  const user = getSessionUser();
  const denied = requireDepartment(user, 'HR');
  if (denied) return denied;

  const b = await req.json();
  const fields = [];
  const args = [];
  for (const key of ['reason', 'resignation_letter_date', 'relieving_date', 'reason_for_leaving',
    'leave_encashed', 'encashment_amount', 'exit_interview_held_on', 'exit_interview_feedback', 'new_workplace']) {
    if (b[key] !== undefined) { fields.push(`${key} = ?`); args.push(b[key]); }
  }
  if (!fields.length) return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  args.push(params.id);
  await execute(`UPDATE employee_separation SET ${fields.join(', ')} WHERE id = ?`, args);
  await audit('employee_separation_updated', { actor: user.username, detail: `#${params.id}` });
  return NextResponse.json({ ok: true });
}
