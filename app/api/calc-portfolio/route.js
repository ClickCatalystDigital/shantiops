import { NextResponse } from 'next/server';
import { getFreshSessionUser } from '@/lib/auth';
import { requireCalcAccess } from '@/lib/calc';
import { getDesignWork } from '@/lib/data';

// Calc Sheets' Portfolio panel — the same cross-project rows the Operations Design master table
// (§E) computes via getDesignWork(), just exposed for the Calc module's own client-side fetch.
export async function GET() {
  const user = await getFreshSessionUser();
  const denied = requireCalcAccess(user);
  if (denied) return denied;

  const rows = await getDesignWork();
  return NextResponse.json({ rows });
}
