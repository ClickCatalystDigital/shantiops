import { NextResponse } from 'next/server';
import { execute } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { getSalarySlipDetail } from '@/lib/data';

export async function GET(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'HR');
  if (denied) return denied;
  const detail = await getSalarySlipDetail(params.id);
  if (!detail) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(detail);
}

export async function PATCH(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'HR');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'HR', 'hr.payroll.slip_status');
  if (actionDenied) return actionDenied;
  const b = await req.json();
  if (!['draft', 'submitted', 'paid'].includes(b.status)) return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
  await execute('UPDATE salary_slips SET status = ? WHERE id = ?', [b.status, params.id]);
  return NextResponse.json({ ok: true });
}
