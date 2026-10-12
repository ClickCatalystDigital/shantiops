// Job card workstation master (Weld Bay 1, CNC Lathe, ...). Mirrors app/api/trades.
// machine_hour_rate feeds labor costing (§3.6) — optional, most stations don't need it.
import { NextResponse } from 'next/server';
import { execute } from '@/lib/db';
import { getFreshSessionUser, requireDepartment, canAccessDepartment, isPM } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { getWorkstations } from '@/lib/data';

export async function GET() {
  const user = await getFreshSessionUser();
  if (!isPM(user) && !canAccessDepartment(user, 'Production')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  return NextResponse.json(await getWorkstations());
}

export async function POST(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Production');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Production', 'production.settings.write');
  if (actionDenied) return actionDenied;
  const b = await req.json();
  const name = String(b.name || '').trim();
  if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 });
  try {
    const { lastId } = await execute(
      'INSERT INTO workstations (name, machine_hour_rate) VALUES (?, ?)',
      [name, b.machine_hour_rate ? Number(b.machine_hour_rate) : null]
    );
    return NextResponse.json({ id: Number(lastId) });
  } catch (e) {
    if (String(e).includes('UNIQUE')) return NextResponse.json({ error: 'That workstation already exists' }, { status: 409 });
    throw e;
  }
}
