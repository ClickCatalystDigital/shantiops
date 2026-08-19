import { NextResponse } from 'next/server';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { getWorkOrderCosting } from '@/lib/data';

export async function GET(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Production');
  if (denied) return denied;
  const costing = await getWorkOrderCosting(params.id);
  if (!costing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(costing);
}
