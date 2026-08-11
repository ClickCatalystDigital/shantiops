import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { requireCalcAccess, deleteFormulaTest } from '@/lib/calc';
import { audit } from '@/lib/usb';

export async function DELETE(req, { params }) {
  const user = getSessionUser();
  const denied = requireCalcAccess(user);
  if (denied) return denied;

  await deleteFormulaTest(params.id);
  await audit('calc_formula_test_deleted', { actor: user.username, detail: `test ${params.id}` });
  return NextResponse.json({ ok: true });
}
