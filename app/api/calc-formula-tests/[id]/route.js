import { NextResponse } from 'next/server';
import { getFreshSessionUser } from '@/lib/auth';
import { requireCalcAccess, deleteFormulaTest } from '@/lib/calc';
import { audit } from '@/lib/usb';

export async function DELETE(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireCalcAccess(user);
  if (denied) return denied;

  await deleteFormulaTest(params.id);
  await audit('calc_formula_test_deleted', { actor: user.username, detail: `test ${params.id}` });
  return NextResponse.json({ ok: true });
}
