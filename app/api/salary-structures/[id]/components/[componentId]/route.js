import { NextResponse } from 'next/server';
import { execute } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';

export async function DELETE(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'HR');
  if (denied) return denied;
  await execute('DELETE FROM salary_structure_components WHERE id = ? AND salary_structure_id = ?', [params.componentId, params.id]);
  return NextResponse.json({ ok: true });
}
