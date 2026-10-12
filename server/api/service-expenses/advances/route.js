// Cash requests with money left that this user can take as advance on a travel claim (own, or naming ?customer=<name>).
import { NextResponse } from 'next/server';
import { getFreshSessionUser, canAccessDepartment } from '@/lib/auth';
import { advanceCandidates } from '@/lib/service-expenses';
import { eligibleAdvances } from '@/lib/service-expense.mjs';

export async function GET(req) {
  const user = await getFreshSessionUser();
  if (!user || !canAccessDepartment(user, 'Installation')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const name = new URL(req.url).searchParams.get('customer') || '';
  return NextResponse.json(eligibleAdvances(await advanceCandidates(), { customerName: name, username: user.username }));
}
