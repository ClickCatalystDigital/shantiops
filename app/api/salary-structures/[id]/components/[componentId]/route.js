import { NextResponse } from 'next/server';
import { execute } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';

export async function DELETE(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'HR');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'HR', 'hr.salary_structure.write');
  if (actionDenied) return actionDenied;
  await execute('DELETE FROM salary_structure_components WHERE id = ? AND salary_structure_id = ?', [params.componentId, params.id]);
  return NextResponse.json({ ok: true });
}
