import { NextResponse } from 'next/server';
import { getFreshSessionUser } from '@/lib/auth';
import { requireCalcAccess, deleteNote } from '@/lib/calc';
import { audit } from '@/lib/usb';

export async function DELETE(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireCalcAccess(user);
  if (denied) return denied;

  await deleteNote(params.id);
  await audit('calc_note_deleted', { actor: user.username, detail: `note ${params.id}` });
  return NextResponse.json({ ok: true });
}
