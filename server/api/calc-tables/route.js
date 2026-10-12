import { NextResponse } from 'next/server';
import { getFreshSessionUser } from '@/lib/auth';
import { requireCalcAccess, addTable } from '@/lib/calc';
import { audit } from '@/lib/usb';

export async function POST(req) {
  const user = await getFreshSessionUser();
  const denied = requireCalcAccess(user);
  if (denied) return denied;

  const b = await req.json();
  const name = String(b.name || '').trim();
  const xColumn = String(b.xColumn || '').trim();
  const columns = Array.isArray(b.columns) ? b.columns : [];
  if (!name || !xColumn || columns.length === 0) {
    return NextResponse.json({ error: 'Name, x column, and at least one value column are required' }, { status: 400 });
  }

  const id = await addTable({ name, standard: b.standard || null, xColumn, xUnit: b.xUnit || null, columns });
  await audit('calc_table_created', { actor: user.username, detail: name });
  return NextResponse.json({ id });
}
