import { NextResponse } from 'next/server';
import { execute } from '@/lib/db';
import { getFreshSessionUser, requireDepartment, canAccessDepartment, isPM } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { getDesignations } from '@/lib/data';

export async function GET() {
  const user = await getFreshSessionUser();
  if (!isPM(user) && !canAccessDepartment(user, 'HR')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  return NextResponse.json(await getDesignations());
}

export async function POST(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'HR');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'HR', 'hr.settings.write');
  if (actionDenied) return actionDenied;
  const b = await req.json();
  const name = String(b.name || '').trim();
  if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 });
  try {
    const { lastId } = await execute('INSERT INTO designations (name) VALUES (?)', [name]);
    return NextResponse.json({ id: Number(lastId) });
  } catch (e) {
    if (String(e).includes('UNIQUE')) return NextResponse.json({ error: 'That designation already exists' }, { status: 409 });
    throw e;
  }
}
