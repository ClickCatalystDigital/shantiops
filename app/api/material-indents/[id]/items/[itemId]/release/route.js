// app/api/material-indents/[id]/items/[itemId]/release/route.js — Stores' scalar/batch/serial
// release action (Feature B). Piece-tracked lines never come through here — see reserve-piece in
// the sibling route. The quantity is CAS-claimed on material_indent_items BEFORE the actual issue
// runs (same "claim, then compensate on failure" shape as the rest of this codebase's own
// concurrency fixes — cutPiece()'s status CAS, issueBatch()'s qty CAS) so two concurrent releases of
// the same remaining quantity can never both succeed.
import { NextResponse } from 'next/server';
import { execute, queryAll, queryOne } from '@/lib/db';
import { getFreshSessionUser } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { issueMaterial } from '@/lib/material-issues';
import { notifyDepartment, notifyUser } from '@/lib/notify';
import { rollupIndentStatus, nextReleaseStatus } from '@/lib/indent-status.mjs';
import { audit } from '@/lib/usb';

export async function POST(req, { params }) {
  const user = await getFreshSessionUser();
  const actionDenied = await requireAction(user, 'Stores', 'stores.indent.release');
  if (actionDenied) return actionDenied;

  const item = await queryOne(
    'SELECT * FROM material_indent_items WHERE id = ? AND indent_id = ?', [params.itemId, params.id]);
  if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (['released', 'cancelled'].includes(item.status)) {
    return NextResponse.json({ error: `Already ${item.status}` }, { status: 409 });
  }

  const invItem = await queryOne('SELECT tracking_mode FROM inventory_items WHERE id = ?', [item.inventory_item_id]);
  if (invItem?.tracking_mode === 'piece') {
    return NextResponse.json({ error: 'This is a piece-tracked line — reserve a specific piece instead' }, { status: 400 });
  }

  const b = await req.json();
  const qty = Number(b.qty);
  if (!Number.isFinite(qty) || !(qty > 0)) return NextResponse.json({ error: 'Enter a quantity' }, { status: 400 });

  const indent = await queryOne('SELECT * FROM material_indents WHERE id = ?', [params.id]);
  if (item.bom_item_id && indent.project_id) {
    const bomItem = await queryOne('SELECT project_id FROM bom_items WHERE id = ?', [item.bom_item_id]);
    if (bomItem && bomItem.project_id !== indent.project_id) {
      return NextResponse.json({ error: "This item's project doesn't match the indent" }, { status: 400 });
    }
  }

  // nextReleaseStatus here is only a fast client-facing rejection ("only X remaining") off the
  // snapshot already in hand — it must never be the value actually WRITTEN. Two concurrent releases
  // both reading qty_released=0 would otherwise both bake in 'partially_released', and whichever
  // CAS commits second (against the row now at qty_released=remaining) would overwrite what should
  // have become 'released' with a stale, wrong status even though the quantity math itself is
  // correct (found in review). The UPDATE below instead derives status from a CASE expression
  // reading the LIVE qty_released column at write time, so it's always consistent with whatever
  // actually landed, regardless of ordering.
  const remaining = item.qty_requested - item.qty_released;
  if (!nextReleaseStatus(item.qty_requested, item.qty_released, qty)) {
    return NextResponse.json({ error: `Only ${remaining} remaining` }, { status: 400 });
  }

  const claim = await execute(
    `UPDATE material_indent_items
        SET qty_released = qty_released + ?,
            status = CASE WHEN qty_released + ? >= qty_requested THEN 'released' ELSE 'partially_released' END
      WHERE id = ? AND qty_released + ? <= qty_requested AND status NOT IN ('released', 'cancelled')`,
    [qty, qty, item.id, qty]
  );
  if (claim.changes !== 1) {
    return NextResponse.json({ error: 'Remaining quantity changed — reload and try again' }, { status: 409 });
  }

  let result;
  try {
    result = await issueMaterial({
      bomItemId: item.bom_item_id, qty, jobCardId: indent.job_card_id,
      username: user.username, indentItemId: item.id,
    });
  } catch (e) {
    // The claim above never actually moved any material — restore the item to exactly what it was
    // before this attempt.
    await execute(
      'UPDATE material_indent_items SET qty_released = ?, status = ? WHERE id = ?',
      [item.qty_released, item.status, item.id]
    );
    return NextResponse.json({ error: e.message }, { status: 400 });
  }

  const allStatuses = (await queryAll(
    'SELECT status FROM material_indent_items WHERE indent_id = ?', [params.id])).map(r => r.status);
  await execute('UPDATE material_indents SET status = ? WHERE id = ?', [rollupIndentStatus(allStatuses), params.id]);

  await audit('indent_released', {
    actor: user.username, detail: `indent #${params.id} item #${item.id} qty ${qty}`,
  });

  try {
    await notifyDepartment('Production', {
      kind: 'indent_released', title: 'Material indent released',
      body: `Qty ${qty} released`, project_id: indent.project_id,
    });
    if (indent.requested_by) {
      const raiser = await queryOne('SELECT id FROM users WHERE username = ?', [indent.requested_by]);
      if (raiser) {
        await notifyUser(raiser.id, {
          kind: 'indent_released', title: 'Your material indent was released',
          body: `Qty ${qty} released`, project_id: indent.project_id,
        });
      }
    }
  } catch (err) { /* notification is best-effort */ }

  return NextResponse.json({ ok: true, material_issue: result });
}
