import { NextResponse } from 'next/server';
import { execute } from '@/lib/db';
import { getSessionUser, requireDepartment, canAccessDepartment, isPM } from '@/lib/auth';
import { getHolidays } from '@/lib/data';

export async function GET() {
  const user = getSessionUser();
  if (!isPM(user) && !canAccessDepartment(user, 'HR')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  return NextResponse.json(await getHolidays());
}

export async function POST(req) {
  const user = getSessionUser();
  const denied = requireDepartment(user, 'HR');
  if (denied) return denied;
  const b = await req.json();
  if (!b.holiday_date) return NextResponse.json({ error: 'holiday_date is required' }, { status: 400 });
  try {
    const { lastId } = await execute(
      'INSERT INTO holidays (holiday_date, name) VALUES (?, ?)', [b.holiday_date, b.name || null]
    );
    return NextResponse.json({ id: Number(lastId) });
  } catch (e) {
    if (String(e).includes('UNIQUE')) return NextResponse.json({ error: 'That date is already a holiday' }, { status: 409 });
    throw e;
  }
}
