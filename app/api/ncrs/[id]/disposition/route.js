// Disposition an NCR — the real authority decision (scrap real material, accept a non-conforming
// product as-is), QC-Head-gated regardless of who raised the NCR. One transaction covers only the
// actual writes; audit/notify happen after commit, per lib/db.js's withTransaction convention.
import { NextResponse } from 'next/server';
import { execute, queryOne, withTransaction } from '@/lib/db';
import { getFreshSessionUser, canAccessDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { audit } from '@/lib/usb';
import { notifyDepartment } from '@/lib/notify';

const DISPOSITIONS = ['rework', 'repair', 'scrap', 'use_as_is'];

export async function POST(req, { params }) {
  const user = await getFreshSessionUser();
  if (!canAccessDepartment(user, 'QC')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const actionDenied = await requireAction(user, 'QC', 'qc.ncr.disposition');
  if (actionDenied) return actionDenied;

  const ncr = await queryOne('SELECT * FROM ncr_records WHERE id = ?', [params.id]);
  if (!ncr) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (ncr.status !== 'open') return NextResponse.json({ error: 'Only an open NCR can be dispositioned' }, { status: 400 });

  const b = await req.json();
  if (!DISPOSITIONS.includes(b.disposition)) {
    return NextResponse.json({ error: 'Invalid disposition' }, { status: 400 });
  }
  const notes = String(b.disposition_notes || '').trim();
  if (['scrap', 'use_as_is'].includes(b.disposition) && !notes) {
    return NextResponse.json({ error: 'Disposition notes are required for scrap / use-as-is' }, { status: 400 });
  }

  let reworkJobCardId = null;

  if (['rework', 'repair'].includes(b.disposition)) {
    if (!ncr.job_card_id) {
      return NextResponse.json({ error: 'Rework/repair requires an NCR linked to a job card' }, { status: 400 });
    }
    const card = await queryOne(
      'SELECT id, project_id, section, milestone_id, bom_item_id, work_order_id, work_order_operation_id, operation_id, workstation_id FROM job_cards WHERE id = ?',
      [ncr.job_card_id]
    );
    if (!card) return NextResponse.json({ error: 'Linked job card not found' }, { status: 400 });
    // Milestone resolved from the card itself, then its route step — else no milestone to attach the
    // rework card to (a real scope boundary, see plan §5d: milestone-only cards outside a work order
    // route have no route step to fall back on either).
    let milestoneId = card.milestone_id;
    if (!milestoneId && card.work_order_operation_id) {
      const op = await queryOne('SELECT milestone_id FROM work_order_operations WHERE id = ?', [card.work_order_operation_id]);
      milestoneId = op?.milestone_id || null;
    }
    if (!milestoneId) return NextResponse.json({ error: "Can't create a rework card — no milestone to attach it to" }, { status: 400 });

    const result = await withTransaction(async tx => {
      // requires_qc_hold is explicitly 0 — this card is reactive rework, not generated from a route
      // step, and must not silently inherit a hold flag from unrelated logic.
      const ins = await tx.execute({
        sql: `INSERT INTO job_cards
                (project_id, milestone_id, section, bom_item_id, work_order_id, work_order_operation_id,
                 operation_id, workstation_id, qty_planned, rework_of_job_card_id, ncr_id, requires_qc_hold, created_by)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 0, ?)`,
        args: [card.project_id, milestoneId, card.section, card.bom_item_id, card.work_order_id,
          card.work_order_operation_id, card.operation_id, card.workstation_id, ncr.job_card_id, ncr.id, user.username],
      });
      const newCardId = Number(ins.lastInsertRowid);
      await tx.execute({
        sql: `UPDATE ncr_records SET status = 'dispositioned', disposition = ?, disposition_notes = ?,
                rework_job_card_id = ?, dispositioned_by = ?, dispositioned_at = CURRENT_TIMESTAMP WHERE id = ?`,
        args: [b.disposition, notes || null, newCardId, user.username, params.id],
      });
      return newCardId;
    });
    reworkJobCardId = result;
  } else if (b.disposition === 'scrap') {
    if (ncr.stock_piece_id) {
      const piece = await queryOne('SELECT id, inventory_item_id, status FROM stock_pieces WHERE id = ?', [ncr.stock_piece_id]);
      if (!piece) return NextResponse.json({ error: 'Linked stock piece not found' }, { status: 400 });
      if (!['available', 'reserved'].includes(piece.status)) {
        return NextResponse.json({ error: `Can't scrap — piece already ${piece.status}` }, { status: 400 });
      }
      await withTransaction(async tx => {
        await tx.execute({ sql: "UPDATE stock_pieces SET status = 'scrap' WHERE id = ?", args: [piece.id] });
        const countRow = await tx.execute({
          sql: "SELECT COUNT(*) AS n FROM stock_pieces WHERE inventory_item_id = ? AND status = 'available'",
          args: [piece.inventory_item_id],
        });
        await tx.execute({ sql: 'UPDATE inventory_items SET on_hand = ? WHERE id = ?', args: [countRow.rows[0].n, piece.inventory_item_id] });
        await tx.execute({
          sql: `UPDATE ncr_records SET status = 'dispositioned', disposition = ?, disposition_notes = ?,
                  dispositioned_by = ?, dispositioned_at = CURRENT_TIMESTAMP WHERE id = ?`,
          args: [b.disposition, notes, user.username, params.id],
        });
      });
    } else {
      await execute(
        `UPDATE ncr_records SET status = 'dispositioned', disposition = ?, disposition_notes = ?,
           dispositioned_by = ?, dispositioned_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [b.disposition, notes, user.username, params.id]
      );
    }
  } else {
    // use_as_is — no material action.
    await execute(
      `UPDATE ncr_records SET status = 'dispositioned', disposition = ?, disposition_notes = ?,
         dispositioned_by = ?, dispositioned_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [b.disposition, notes, user.username, params.id]
    );
  }

  await audit('ncr_dispositioned', { actor: user.username, detail: `${ncr.ncr_no} · ${b.disposition}` });
  try {
    await notifyDepartment('Production', {
      kind: 'ncr_dispositioned', title: `NCR ${ncr.ncr_no} dispositioned: ${b.disposition}`,
      project_id: ncr.project_id, dedupe_key: `ncr_dispositioned:${ncr.id}`,
    });
    if (ncr.stock_piece_id && b.disposition === 'scrap') {
      await notifyDepartment('Stores', {
        kind: 'ncr_dispositioned', title: `NCR ${ncr.ncr_no} scrapped a stock piece`,
        project_id: ncr.project_id, dedupe_key: `ncr_scrap_stores:${ncr.id}`,
      });
    }
  } catch (err) { /* notification is best-effort */ }

  return NextResponse.json({ ok: true, rework_job_card_id: reworkJobCardId });
}
