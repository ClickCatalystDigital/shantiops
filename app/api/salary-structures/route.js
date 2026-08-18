// app/api/salary-structures/route.js — HR completion bundle. Structure shell; component lines
// live under [id]/components. No separate salary_components master catalog (lib/db.js comment) —
// component identity is just a name scoped to its structure.
import { NextResponse } from 'next/server';
import { execute } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { getSalaryStructures } from '@/lib/data';
import { audit } from '@/lib/usb';

export async function GET() {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'HR');
  if (denied) return denied;
  return NextResponse.json(await getSalaryStructures());
}

export async function POST(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'HR');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'HR', 'hr.salary_structure.write');
  if (actionDenied) return actionDenied;
  const b = await req.json();
  const name = String(b.name || '').trim();
  if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 });
  const { lastId } = await execute('INSERT INTO salary_structures (name) VALUES (?)', [name]);
  await audit('salary_structure_created', { actor: user.username, detail: name });
  return NextResponse.json({ id: Number(lastId) });
}
