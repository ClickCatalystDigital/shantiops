// app/api/stock-pieces/[id]/reserve/route.js — Stores' manual counterpart to lib/remnant-match.js's
// automatic matching: pick a specific available piece for a specific project/BOM line by hand.
import { NextResponse } from 'next/server';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { reservePiece } from '@/lib/stock-pieces';
import { audit } from '@/lib/usb';

export async function POST(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Stores');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Stores', 'stores.reservation.reserve');
  if (actionDenied) return actionDenied;

  const b = await req.json();
  const projectId = b.project_id ? Number(b.project_id) : null;
  const bomItemId = b.bom_item_id ? Number(b.bom_item_id) : null;
  try {
    await reservePiece({ pieceId: Number(params.id), projectId, bomItemId });
    await audit('stock_piece_reserved', {
      actor: user.username,
      detail: `piece ${params.id} -> bom_item ${bomItemId}`,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
