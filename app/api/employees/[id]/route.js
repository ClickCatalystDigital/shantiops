import { NextResponse } from 'next/server';
import { execute } from '@/lib/db';
import { getSessionUser, requireDepartment } from '@/lib/auth';
import { getEmployeeDetail } from '@/lib/data';
import { audit } from '@/lib/usb';

export async function GET(req, { params }) {
  const user = getSessionUser();
  const denied = requireDepartment(user, 'HR');
  if (denied) return denied;
  const detail = await getEmployeeDetail(params.id);
  if (!detail) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(detail);
}

export async function PATCH(req, { params }) {
  const user = getSessionUser();
  const denied = requireDepartment(user, 'HR');
  if (denied) return denied;

  const b = await req.json();
  const fields = [];
  const args = [];
  for (const key of ['name', 'employee_type', 'designation_id', 'employment_type_id', 'department',
    'trade', 'user_id', 'date_of_joining', 'phone', 'email', 'active',
    // V3_CHANGES.md §13
    'gender', 'date_of_birth', 'photo_url', 'reports_to', 'current_address', 'permanent_address',
    'emergency_contact_name', 'emergency_contact_phone', 'emergency_contact_relation', 'personal_email',
    'scheduled_confirmation_date', 'final_confirmation_date', 'contract_end_date', 'notice_period_days',
    'date_of_retirement', 'salary_mode', 'bank_name', 'bank_account_no', 'bank_ifsc', 'ctc', 'salary_currency']) {
    if (b[key] !== undefined) { fields.push(`${key} = ?`); args.push(b[key]); }
  }
  if (!fields.length) return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  fields.push('updated_at = CURRENT_TIMESTAMP');
  args.push(params.id);
  await execute(`UPDATE employees SET ${fields.join(', ')} WHERE id = ?`, args);
  await audit('employee_updated', { actor: user.username, detail: `#${params.id}` });
  return NextResponse.json({ ok: true });
}
