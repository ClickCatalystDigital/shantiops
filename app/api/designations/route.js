import { NextResponse } from 'next/server';
import { execute } from '@/lib/db';
import { getSessionUser, requireDepartment, canAccessDepartment, isPM } from '@/lib/auth';
import { getDesignations } from '@/lib/data';

export async function GET() {
  const user = getSessionUser();
  if (!isPM(user) && !canAccessDepartment(user, 'HR')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  return NextResponse.json(await getDesignations());
}

export async function POST(req) {
  const user = getSessionUser();
  const denied = requireDepartment(user, 'HR');
  if (denied) return denied;
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
