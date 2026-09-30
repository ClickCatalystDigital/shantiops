// app/api/stock-pieces/[id]/cut/route.js — Production's Cut action (BOM tab). Works the same
// whether the source piece was auto-reserved by lib/remnant-match.js or picked manually.
import { NextResponse } from 'next/server';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { cutPiece } from '@/lib/stock-pieces';
import { audit } from '@/lib/usb';
import { queryOne } from '@/lib/db';

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
  // A certified piece cut with no project and no BOM line silently drops the certificate-to-project
  // record IBR traceability needs (cutPiece only links when a project is known), so require one.
  const projectId = b.project_id ? Number(b.project_id) : null;
  if (!projectId && !b.bom_item_id) {
    const src = await queryOne('SELECT test_certificate_id FROM stock_pieces WHERE id = ?', [Number(params.id)]);
    if (src?.test_certificate_id) {
      return NextResponse.json({ error: 'This piece carries a test certificate. Pick the project it is being cut for.' }, { status: 400 });
    }
  }
  const note = String(b.note || '').trim().slice(0, 300);
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
      detail: `piece ${params.id}: used ${result.usedWeight} kg · remnant ${result.remnantWeight} kg · scrap ${result.scrapWeight} kg${note ? ` · note: ${note}` : ''}`,
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
