// Steel saved by reusing remnants (lib/data.js getRemnantSavings) — the line on Production → Remnants.
import { NextResponse } from 'next/server';
import { getFreshSessionUser, isInternal } from '@/lib/auth';
import { getRemnantSavings } from '@/lib/data';

export async function GET() {
  const user = await getFreshSessionUser();
  if (!isInternal(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  return NextResponse.json(await getRemnantSavings());
}
