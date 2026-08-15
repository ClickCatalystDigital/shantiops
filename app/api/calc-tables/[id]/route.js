import { NextResponse } from 'next/server';
import { getFreshSessionUser } from '@/lib/auth';
import { requireCalcAccess, deleteTable } from '@/lib/calc';
import { audit } from '@/lib/usb';

export async function DELETE(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireCalcAccess(user);
  if (denied) return denied;

  await deleteTable(params.id);
  await audit('calc_table_deleted', { actor: user.username, detail: `table ${params.id}` });
  return NextResponse.json({ ok: true });
}
