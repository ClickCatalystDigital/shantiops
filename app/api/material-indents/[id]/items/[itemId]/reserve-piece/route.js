// app/api/material-indents/[id]/items/[itemId]/reserve-piece/route.js — Stores' piece-tracked
// release action (Feature B). Binary per line (reserved or not) — a multi-piece need is multiple
// indent items, matching how lib/remnant-match.js already treats multi-piece BOM lines. CAS-guarded
// on the indent item itself first so two concurrent reserve attempts on the same item can't both
// succeed; reservePiece()'s own CAS (status='available' required) is what actually prevents
// claiming an already-consumed/reserved piece, surfaced here as a clean 409 rather than a raw error.
import { NextResponse } from 'next/server';
import { execute, queryOne, queryAll } from '@/lib/db';
import { getFreshSessionUser } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { reservePiece } from '@/lib/stock-pieces';
import { notifyDepartment, notifyUser } from '@/lib/notify';
import { rollupIndentStatus } from '@/lib/indent-status.mjs';
import { audit } from '@/lib/usb';

export async function POST(req, { params }) {
  const user = await getFreshSessionUser();
  const actionDenied = await requireAction(user, 'Stores', 'stores.indent.release');
  if (actionDenied) return actionDenied;

  const item = await queryOne(
    'SELECT * FROM material_indent_items WHERE id = ? AND indent_id = ?', [params.itemId, params.id]);
  if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const b = await req.json();
  const pieceId = Number(b.piece_id);
  if (!pieceId) return NextResponse.json({ error: 'piece_id is required' }, { status: 400 });

  // reservePiece() itself never checks material identity (it only validates the bom_item's own
  // project/status) — the built UI always fetches pieces already scoped to this indent item's own
  // inventory_item_id, but a forged request could name any piece_id at all. Checked here so the
  // route is the real gate, not just the UI (gap found in review).
  const piece = await queryOne('SELECT inventory_item_id, code FROM stock_pieces WHERE id = ?', [pieceId]);
  if (!piece) return NextResponse.json({ error: 'Piece not found' }, { status: 404 });
  if (item.inventory_item_id && piece.inventory_item_id !== item.inventory_item_id) {
    return NextResponse.json({ error: "That piece doesn't match this indent item's material" }, { status: 400 });
  }

  const claim = await execute(
    "UPDATE material_indent_items SET status = 'released' WHERE id = ? AND status = 'open'",
    [item.id]
  );
  if (claim.changes !== 1) {
    return NextResponse.json({ error: `Already ${item.status === 'open' ? 'claimed' : item.status}` }, { status: 409 });
  }

  const indent = await queryOne('SELECT * FROM material_indents WHERE id = ?', [params.id]);
  try {
    await reservePiece({ pieceId, projectId: indent.project_id, bomItemId: item.bom_item_id });
  } catch (e) {
    // The piece was never actually reserved — restore the item to its pre-claim state.
    await execute("UPDATE material_indent_items SET status = 'open' WHERE id = ?", [item.id]);
    return NextResponse.json({ error: 'This piece is no longer available' }, { status: 409 });
  }
  await execute('UPDATE material_indent_items SET stock_piece_id = ? WHERE id = ?', [pieceId, item.id]);
  await execute('UPDATE stock_pieces SET indent_item_id = ? WHERE id = ?', [item.id, pieceId]);

  const allStatuses = (await queryAll(
    'SELECT status FROM material_indent_items WHERE indent_id = ?', [params.id])).map(r => r.status);
  await execute('UPDATE material_indents SET status = ? WHERE id = ?', [rollupIndentStatus(allStatuses), params.id]);

  await audit('indent_piece_reserved', {
    actor: user.username, detail: `indent #${params.id} item #${item.id} -> piece ${piece?.code || pieceId}`,
  });

  try {
    await notifyDepartment('Production', {
      kind: 'indent_released', title: 'Material indent released',
      body: `Piece ${piece?.code || ''} reserved`, project_id: indent.project_id,
    });
    if (indent.requested_by) {
      const raiser = await queryOne('SELECT id FROM users WHERE username = ?', [indent.requested_by]);
      if (raiser) {
        await notifyUser(raiser.id, {
          kind: 'indent_released', title: 'Your material indent was released',
          body: `Piece ${piece?.code || ''} reserved — ready to cut`, project_id: indent.project_id,
        });
      }
    }
  } catch (err) { /* notification is best-effort */ }

  return NextResponse.json({ ok: true, piece_id: pieceId });
}
