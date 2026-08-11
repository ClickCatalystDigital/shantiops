import { NextResponse } from 'next/server';
import { execute } from '@/lib/db';
import { getSessionUser, requireDepartment } from '@/lib/auth';
import { getExpenseClaimTypes } from '@/lib/data';

export async function GET() {
  const user = getSessionUser();
  const denied = requireDepartment(user, 'HR');
  if (denied) return denied;
  return NextResponse.json(await getExpenseClaimTypes());
}

export async function POST(req) {
  const user = getSessionUser();
  const denied = requireDepartment(user, 'HR');
  if (denied) return denied;
  const b = await req.json();
  const name = String(b.name || '').trim();
  if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 });
  const { lastId } = await execute('INSERT INTO expense_claim_types (name) VALUES (?)', [name]);
  return NextResponse.json({ id: Number(lastId) });
}
