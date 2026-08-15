import { NextResponse } from 'next/server';
import { getFreshSessionUser } from '@/lib/auth';
import { requireCalcAccess, deleteValidation } from '@/lib/calc';
import { audit } from '@/lib/usb';

export async function DELETE(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireCalcAccess(user);
  if (denied) return denied;

  await deleteValidation(params.id);
  await audit('calc_validation_deleted', { actor: user.username, detail: `validation ${params.id}` });
  return NextResponse.json({ ok: true });
}
