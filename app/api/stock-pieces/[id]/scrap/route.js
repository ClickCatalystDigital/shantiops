// app/api/stock-pieces/[id]/scrap/route.js — "Scrap it" for a returned remnant that is unusable.
// Production (who carried it back) or Stores (who is about to confirm it) may do it.
import { NextResponse } from 'next/server';
import { getFreshSessionUser, canAccessDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { scrapPiece } from '@/lib/stock-pieces';
import { audit } from '@/lib/usb';

export async function POST(req, { params }) {
  const user = await getFreshSessionUser();
  const dept = canAccessDepartment(user, 'Production') ? 'Production' : canAccessDepartment(user, 'Stores') ? 'Stores' : null;
  if (!dept) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const denied = await requireAction(user, dept, dept === 'Production' ? 'production.bom.cut' : 'stores.inventory.write');
  if (denied) return denied;
  try {
    await scrapPiece(Number(params.id), user.username);
    await audit('stock_piece_scrapped', { actor: user.username, detail: `piece ${params.id}` });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
