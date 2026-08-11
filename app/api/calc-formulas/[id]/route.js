import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { requireCalcAccess, saveFormulaVersion, setFormulaStatus } from '@/lib/calc';
import { audit } from '@/lib/usb';

const STATUSES = ['draft', 'pending', 'approved', 'deprecated'];

// Two distinct edits share this endpoint, same as the prototype: a status transition
// (Submit/Approve — { status }) or a new expression version, which resets status to draft ({ expr }).
export async function PATCH(req, { params }) {
  const user = getSessionUser();
  const denied = requireCalcAccess(user);
  if (denied) return denied;

  const b = await req.json();

  if (b.status !== undefined) {
    if (!STATUSES.includes(b.status)) return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
    try {
      await setFormulaStatus(params.id, b.status, b.sheetId);
    } catch (e) {
      // Phase 1.4 gate (setFormulaStatus) throws with statusCode=400 when tests fail — anything
      // else is a real server error and should surface as one.
      if (e.statusCode) return NextResponse.json({ error: e.message }, { status: e.statusCode });
      throw e;
    }
    await audit('calc_formula_status', { actor: user.username, detail: `formula ${params.id} -> ${b.status}` });
    return NextResponse.json({ ok: true });
  }

  if (b.expr !== undefined) {
    const expr = String(b.expr).trim();
    if (!expr) return NextResponse.json({ error: 'Expression is required' }, { status: 400 });
    await saveFormulaVersion(params.id, expr, b.note || '', b.guardExpr ? String(b.guardExpr).trim() : null);
    await audit('calc_formula_new_version', { actor: user.username, detail: `formula ${params.id}` });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
}
