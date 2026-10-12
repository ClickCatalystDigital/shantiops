// The backup workbook: exactly the rows a cleanup would delete. Downloading it is what unlocks the cleanup.
import { NextResponse } from 'next/server';
import { getFreshSessionUser, isDepartmentHead } from '@/lib/auth';
import { buildBackup } from '@/lib/sales-retention';

export const runtime = 'nodejs';

export async function GET() {
  const user = await getFreshSessionUser();
  if (!isDepartmentHead(user, 'Sales')) return NextResponse.json({ error: 'Only a Sales Head can manage data retention' }, { status: 403 });
  try {
    const buf = await buildBackup(user.username);
    return new NextResponse(buf, { headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="sales-history-backup-${new Date().toISOString().slice(0, 10)}.xlsx"`,
    } });
  } catch (err) { return NextResponse.json({ error: err.message }, { status: 400 }); }
}
