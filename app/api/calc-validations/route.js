import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { requireCalcAccess, addValidation } from '@/lib/calc';
import { audit } from '@/lib/usb';

export async function POST(req) {
  const user = getSessionUser();
  const denied = requireCalcAccess(user);
  if (denied) return denied;

  const b = await req.json();
  const name = String(b.name || '').trim();
  const expr = String(b.expr || '').trim();
  if (!name || !expr) return NextResponse.json({ error: 'Name and expression are required' }, { status: 400 });

  const id = await addValidation({ name, expr, severity: b.severity === 'fail' ? 'fail' : 'warning', message: b.message || '' });
  await audit('calc_validation_created', { actor: user.username, detail: name });
  return NextResponse.json({ id });
}
