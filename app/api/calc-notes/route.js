import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { requireCalcAccess, addNote } from '@/lib/calc';
import { audit } from '@/lib/usb';

const ENTITY_TYPES = ['variable', 'formula'];

export async function POST(req) {
  const user = getSessionUser();
  const denied = requireCalcAccess(user);
  if (denied) return denied;

  const b = await req.json();
  const note = String(b.note || '').trim();
  if (!ENTITY_TYPES.includes(b.entityType)) return NextResponse.json({ error: 'Invalid entity type' }, { status: 400 });
  if (!b.entityId || !note) return NextResponse.json({ error: 'Entity and note text are required' }, { status: 400 });

  const id = await addNote({ sheetId: b.sheetId, entityType: b.entityType, entityId: b.entityId, author: user.username, note });
  await audit('calc_note_added', { actor: user.username, detail: `${b.entityType} ${b.entityId}` });
  return NextResponse.json({ id });
}
