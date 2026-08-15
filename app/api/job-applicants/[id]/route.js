// app/api/job-applicants/[id]/route.js — V3_CHANGES.md §12 decision 7, fourth use of the
// "accept -> auto-create the next record" playbook. status='hired' calls the same
// createEmployeeWithOnboarding() helper app/api/employees/route.js uses, so a Recruitment hire
// and a direct new-hire seed onboarding identically.
import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { createEmployeeWithOnboarding } from '@/lib/hr';
import { audit } from '@/lib/usb';

const STATUSES = ['applied', 'screening', 'interview', 'offered', 'hired', 'rejected'];

export async function PATCH(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'HR');
  if (denied) return denied;

  const applicant = await queryOne('SELECT * FROM job_applicants WHERE id = ?', [params.id]);
  if (!applicant) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const b = await req.json();
  if (b.status !== undefined && !STATUSES.includes(b.status)) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
  }
  if (b.status === 'hired' && applicant.status !== 'hired') {
    const opening = await queryOne('SELECT * FROM job_openings WHERE id = ?', [applicant.job_opening_id]);
    const { employeeId, employeeCode } = await createEmployeeWithOnboarding({
      name: applicant.name, phone: applicant.phone, email: applicant.email,
      department: opening?.department || null, employment_type_id: opening?.employment_type_id || null,
    });
    await execute(
      `UPDATE job_applicants SET status = 'hired', updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [params.id]
    );
    await audit('applicant_hired', { actor: user.username, detail: `applicant #${params.id} -> ${employeeCode}` });
    return NextResponse.json({ ok: true, employee_id: employeeId, employee_code: employeeCode });
  }

  const fields = [];
  const args = [];
  for (const key of ['status', 'notes']) {
    if (b[key] !== undefined) { fields.push(`${key} = ?`); args.push(b[key]); }
  }
  if (!fields.length) return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  fields.push('updated_at = CURRENT_TIMESTAMP');
  args.push(params.id);
  await execute(`UPDATE job_applicants SET ${fields.join(', ')} WHERE id = ?`, args);
  return NextResponse.json({ ok: true });
}
