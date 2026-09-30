import { NextResponse } from 'next/server';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { getUndoableRoutings } from '@/lib/stores-undo';

export async function GET() {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Stores');
  if (denied) return denied;
  return NextResponse.json(await getUndoableRoutings());
}
