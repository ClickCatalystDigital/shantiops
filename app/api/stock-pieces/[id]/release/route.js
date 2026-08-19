// app/api/stock-pieces/[id]/release/route.js — Stores-visible manual un-reserve, for when a
// matched BOM line gets cancelled/edited before Production ever cuts the reserved piece.
import { NextResponse } from 'next/server';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { releasePiece } from '@/lib/stock-pieces';
import { audit } from '@/lib/usb';

export async function POST(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Stores');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Stores', 'stores.reservation.release');
  if (actionDenied) return actionDenied;

  try {
    await releasePiece(Number(params.id));
    await audit('stock_piece_released', { actor: user.username, detail: `piece ${params.id}` });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
