// app/api/stock-pieces/[id]/cut/route.js — Production's Cut action (BOM tab). Works the same
// whether the source piece was auto-reserved by lib/remnant-match.js or picked manually.
import { NextResponse } from 'next/server';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { cutPiece } from '@/lib/stock-pieces';
import { audit } from '@/lib/usb';

export async function POST(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Production');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Production', 'production.bom.cut');
  if (actionDenied) return actionDenied;

  const b = await req.json();
  if (!Array.isArray(b.used) || !Array.isArray(b.remnants)) {
    return NextResponse.json({ error: 'used and remnants must be arrays' }, { status: 400 });
  }
  try {
    const result = await cutPiece({
      sourcePieceId: Number(params.id), used: b.used, remnants: b.remnants,
      projectId: b.project_id ? Number(b.project_id) : null,
      bomItemId: b.bom_item_id ? Number(b.bom_item_id) : null,
      jobCardId: b.job_card_id ? Number(b.job_card_id) : null,
      username: user.username,
    });
    await audit('stock_piece_cut', {
      actor: user.username,
      detail: `piece ${params.id}: used ${result.usedWeight} kg · remnant ${result.remnantWeight} kg · scrap ${result.scrapWeight} kg`,
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
