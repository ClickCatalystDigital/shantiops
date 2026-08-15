import { NextResponse } from 'next/server';
import { getFreshSessionUser } from '@/lib/auth';
import { requireCalcAccess, applyTemplate, deleteTemplate } from '@/lib/calc';
import { audit } from '@/lib/usb';

// One route, two verbs: PATCH applies the template to the live registry (writes), DELETE removes it.
export async function PATCH(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireCalcAccess(user);
  if (denied) return denied;

  const b = await req.json().catch(() => ({}));
  if (!b.sheetId) return NextResponse.json({ error: 'sheetId is required' }, { status: 400 });
  const applied = await applyTemplate(params.id, b.sheetId);
  await audit('calc_template_applied', { actor: user.username, detail: `template ${params.id} (${applied} variables)` });
  return NextResponse.json({ applied });
}

export async function DELETE(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireCalcAccess(user);
  if (denied) return denied;

  await deleteTemplate(params.id);
  await audit('calc_template_deleted', { actor: user.username, detail: `template ${params.id}` });
  return NextResponse.json({ ok: true });
}
