import { NextResponse } from 'next/server';
import { execute } from '@/lib/db';
import { getFreshSessionUser, requireDepartment, isInternal } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { getExpenseClaimTypes } from '@/lib/data';

// Widened to any internal user (Phase 4, Gap #9) — self-submitting a claim needs the same type
// list HR itself picks from; the write side below is still HR-only.
export async function GET() {
  const user = await getFreshSessionUser();
  if (!isInternal(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  return NextResponse.json(await getExpenseClaimTypes());
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
  const { lastId } = await execute('INSERT INTO expense_claim_types (name) VALUES (?)', [name]);
  return NextResponse.json({ id: Number(lastId) });
}
