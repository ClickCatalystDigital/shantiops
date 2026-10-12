import { NextResponse } from 'next/server';
import { getFreshSessionUser, isDepartmentHead } from '@/lib/auth';
import { previewRetention } from '@/lib/sales-retention';

export async function GET() {
  const user = await getFreshSessionUser();
  if (!isDepartmentHead(user, 'Sales')) return NextResponse.json({ error: 'Only a Sales Head can manage data retention' }, { status: 403 });
  return NextResponse.json(await previewRetention());
}
