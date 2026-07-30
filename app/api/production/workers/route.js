// Shop-floor workers. These people never log in — this is a roster, not an account.
import { NextResponse } from 'next/server';
import { execute } from '@/lib/db';
import { getSessionUser, requireDepartment } from '@/lib/auth';

export async function POST(req) {
  const user = getSessionUser();
  const denied = requireDepartment(user, 'Production');
  if (denied) return denied;

  const b = await req.json();
  const name = String(b.name || '').trim();
  if (!name) return NextResponse.json({ error: 'Worker name is required' }, { status: 400 });

  const { lastId } = await execute(
    "INSERT INTO workers (name, trade, department) VALUES (?, ?, 'Production')",
    [name, String(b.trade || '').trim() || null]
  );
  return NextResponse.json({ id: Number(lastId) });
}
