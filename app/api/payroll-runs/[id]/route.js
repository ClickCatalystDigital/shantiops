import { NextResponse } from 'next/server';
import { execute } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { getPayrollRunDetail } from '@/lib/data';

export async function GET(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'HR');
  if (denied) return denied;
  const detail = await getPayrollRunDetail(params.id);
  if (!detail) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(detail);
}

export async function PATCH(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'HR');
  if (denied) return denied;
  const b = await req.json();
  if (!['processed', 'submitted'].includes(b.status)) return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
  await execute('UPDATE payroll_runs SET status = ? WHERE id = ?', [b.status, params.id]);
  if (b.status === 'submitted') {
    await execute("UPDATE salary_slips SET status = 'submitted' WHERE payroll_run_id = ? AND status = 'draft'", [params.id]);
  }
  return NextResponse.json({ ok: true });
}
