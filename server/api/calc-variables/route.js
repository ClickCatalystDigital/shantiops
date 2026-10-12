import { NextResponse } from 'next/server';
import { getFreshSessionUser } from '@/lib/auth';
import { requireCalcAccess, addVariable } from '@/lib/calc';
import { audit } from '@/lib/usb';

export async function POST(req) {
  const user = await getFreshSessionUser();
  const denied = requireCalcAccess(user);
  if (denied) return denied;

  const b = await req.json();
  const name = String(b.name || '').trim();
  if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 });
  if (!b.sheetId) return NextResponse.json({ error: 'sheetId is required' }, { status: 400 });

  const id = await addVariable({ sheetId: b.sheetId, name, type: b.type || 'input', unit: b.unit || null, value: b.value, columns: b.columns });
  await audit('calc_variable_created', { actor: user.username, detail: name });
  return NextResponse.json({ id });
}
