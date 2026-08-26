// app/api/stock-pieces/[id]/confirm-receipt/route.js — Stores' physical-handoff confirmation for a
// freshly cut remnant (Phase 2, design 18.4). Mirrors app/api/stock-pieces/[id]/release/route.js.
import { NextResponse } from 'next/server';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { confirmPieceReceipt } from '@/lib/stock-pieces';
import { audit } from '@/lib/usb';

export async function POST(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Stores');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Stores', 'stores.inventory.write');
  if (actionDenied) return actionDenied;

  try {
    await confirmPieceReceipt(Number(params.id));
    await audit('stock_piece_receipt_confirmed', { actor: user.username, detail: `piece ${params.id}` });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
