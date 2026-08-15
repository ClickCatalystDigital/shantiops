import { NextResponse } from 'next/server';
import { getFreshSessionUser } from '@/lib/auth';
import { requireCalcAccess, deleteTableRow } from '@/lib/calc';
import { audit } from '@/lib/usb';

export async function DELETE(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireCalcAccess(user);
  if (denied) return denied;

  await deleteTableRow(params.rowId);
  await audit('calc_table_row_deleted', { actor: user.username, detail: `row ${params.rowId}` });
  return NextResponse.json({ ok: true });
}
