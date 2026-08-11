import { NextResponse } from 'next/server';
import { execute } from '@/lib/db';
import { getSessionUser, requireDepartment } from '@/lib/auth';
import { audit } from '@/lib/usb';

const STATUSES = ['requested', 'approved', 'paid', 'settled'];

export async function PATCH(req, { params }) {
  const user = getSessionUser();
  const denied = requireDepartment(user, 'HR');
  if (denied) return denied;
  const b = await req.json();
  if (!STATUSES.includes(b.status)) return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
  await execute('UPDATE employee_advances SET status = ? WHERE id = ?', [b.status, params.id]);
  await audit(`employee_advance_${b.status}`, { actor: user.username, detail: `#${params.id}` });
  return NextResponse.json({ ok: true });
}
