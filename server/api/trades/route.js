// Shop-floor skill list — Production-owned (distinct from HR's designations). See the `trades`
// table comment in lib/db.js.
import { NextResponse } from 'next/server';
import { execute } from '@/lib/db';
import { getFreshSessionUser, requireDepartment, canAccessDepartment, isPM } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { getTrades } from '@/lib/data';

export async function GET() {
  const user = await getFreshSessionUser();
  if (!isPM(user) && !canAccessDepartment(user, 'Production')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  return NextResponse.json(await getTrades());
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
    const { lastId } = await execute('INSERT INTO trades (name) VALUES (?)', [name]);
    return NextResponse.json({ id: Number(lastId) });
  } catch (e) {
    if (String(e).includes('UNIQUE')) return NextResponse.json({ error: 'That trade already exists' }, { status: 409 });
    throw e;
  }
}
