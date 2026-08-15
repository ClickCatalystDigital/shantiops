import { NextResponse } from 'next/server';
import { getFreshSessionUser } from '@/lib/auth';
import { requireCalcAccess, addFormulaTest } from '@/lib/calc';
import { audit } from '@/lib/usb';

export async function POST(req) {
  const user = await getFreshSessionUser();
  const denied = requireCalcAccess(user);
  if (denied) return denied;

  const b = await req.json();
  const name = String(b.name || '').trim();
  const formulaId = Number(b.formulaId);
  const inputs = b.inputs && typeof b.inputs === 'object' ? b.inputs : {};
  if (!name || !formulaId || b.expectedOutput === undefined || b.expectedOutput === null || b.expectedOutput === '') {
    return NextResponse.json({ error: 'Name, formula, and expected output are required' }, { status: 400 });
  }

  const id = await addFormulaTest({ formulaId, name, inputs, expectedOutput: b.expectedOutput, tolerance: b.tolerance });
  await audit('calc_formula_test_created', { actor: user.username, detail: `formula ${formulaId}: ${name}` });
  return NextResponse.json({ id });
}
