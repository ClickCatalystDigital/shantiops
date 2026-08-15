import { NextResponse } from 'next/server';
import { getFreshSessionUser } from '@/lib/auth';
import { requireCalcAccess, addTableRow } from '@/lib/calc';
import { audit } from '@/lib/usb';

export async function POST(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireCalcAccess(user);
  if (denied) return denied;

  const b = await req.json();
  if (b.x === undefined || b.x === null || b.x === '') {
    return NextResponse.json({ error: 'x value is required' }, { status: 400 });
  }
  const values = b.values && typeof b.values === 'object' ? b.values : {};

  const id = await addTableRow(params.id, b.x, values);
  await audit('calc_table_row_added', { actor: user.username, detail: `table ${params.id}, x=${b.x}` });
  return NextResponse.json({ id });
}
