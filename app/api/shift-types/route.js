import { NextResponse } from 'next/server';
import { execute } from '@/lib/db';
import { getSessionUser, requireDepartment, canAccessDepartment, isPM } from '@/lib/auth';
import { getShiftTypes } from '@/lib/data';

export async function GET() {
  const user = getSessionUser();
  if (!isPM(user) && !canAccessDepartment(user, 'HR')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  return NextResponse.json(await getShiftTypes());
}

export async function POST(req) {
  const user = getSessionUser();
  const denied = requireDepartment(user, 'HR');
  if (denied) return denied;
  const b = await req.json();
  const name = String(b.name || '').trim();
  if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 });
  const { lastId } = await execute(
    'INSERT INTO shift_types (name, start_time, end_time) VALUES (?, ?, ?)',
    [name, b.start_time || null, b.end_time || null]
  );
  return NextResponse.json({ id: Number(lastId) });
}
