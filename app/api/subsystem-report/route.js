import { NextResponse } from 'next/server';
import { getFreshSessionUser } from '@/lib/auth';
import { requireEngineeringAction } from '@/lib/action-permissions';
import { getSubsystemFamilies, getSubsystemMatrix } from '@/lib/subsystem-report';

// Read-only. ?family=<key> -> the matrix for one family; otherwise the list of families.
export async function GET(req) {
  const user = await getFreshSessionUser();
  const denied = await requireEngineeringAction(user, 'engineering.assembly.add');
  if (denied) return denied;
  const family = new URL(req.url).searchParams.get('family');
  if (!family) return NextResponse.json({ families: await getSubsystemFamilies() });
  const matrix = await getSubsystemMatrix(family);
  if (!matrix) return NextResponse.json({ error: 'Family not found' }, { status: 404 });
  return NextResponse.json(matrix);
}
