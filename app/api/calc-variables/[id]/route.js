import { NextResponse } from 'next/server';
import { getFreshSessionUser } from '@/lib/auth';
import { requireCalcAccess, updateVariableValue, updateVariableArrayRows, deleteVariable } from '@/lib/calc';
import { audit } from '@/lib/usb';

export async function PATCH(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireCalcAccess(user);
  if (denied) return denied;

  const b = await req.json();
  if (b.rows !== undefined) {
    await updateVariableArrayRows(params.id, b.rows);
    await audit('calc_variable_edit', { actor: user.username, detail: `variable ${params.id} rows updated (${b.rows.length})` });
    return NextResponse.json({ ok: true });
  }
  if (b.value === undefined) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });

  await updateVariableValue(params.id, b.value);
  await audit('calc_variable_edit', { actor: user.username, detail: `variable ${params.id} = ${b.value}` });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireCalcAccess(user);
  if (denied) return denied;

  await deleteVariable(params.id);
  await audit('calc_variable_deleted', { actor: user.username, detail: `variable ${params.id}` });
  return NextResponse.json({ ok: true });
}
