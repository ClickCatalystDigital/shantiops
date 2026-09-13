// Inward QC/Production Approval Workflow — the one place a delivery's inward review is decided.
// QC-Head-only (real business decision — does this material become usable Stores inventory).
// On approve: releases every held stock_piece/scalar hold this approval covers, finishing exactly
// the link maybeCreatePieceStock/maybeReserveScalarStock would have made at receipt time had the
// material not been withheld. On reject: nothing is released — the pieces stay pending_qc_inward,
// the scalar quantity stays un-credited, until a resubmission is approved.
import { NextResponse } from 'next/server';
import { getFreshSessionUser } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { execute, queryOne, queryAll } from '@/lib/db';
import { releasePieceFromInwardHold } from '@/lib/stock-pieces';
import { releaseScalarFromInwardHold } from '@/lib/bom-receiving';
import { notifyDepartment } from '@/lib/notify';
import { audit } from '@/lib/usb';

export async function POST(req, { params }) {
  const user = await getFreshSessionUser();
  const actionDenied = await requireAction(user, 'QC', 'qc.inward.decide');
  if (actionDenied) return actionDenied;

  const approval = await queryOne('SELECT * FROM inward_approvals WHERE id = ?', [params.id]);
  if (!approval) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (approval.status !== 'pending') {
    return NextResponse.json({ error: `Already ${approval.status}` }, { status: 400 });
  }

  const b = await req.json();
  if (!['approved', 'rejected'].includes(b.decision)) {
    return NextResponse.json({ error: 'decision must be approved or rejected' }, { status: 400 });
  }
  // reason is optional free text on either decision, per the user's own original wording — no
  // server-side "reason required" validation.
  const reason = b.reason ? String(b.reason).trim() || null : null;

  if (b.decision === 'approved') {
    const pieces = await queryAll(
      "SELECT id FROM stock_pieces WHERE bom_item_receipt_id = ? AND status = 'pending_qc_inward'",
      [approval.bom_item_receipt_id]);
    for (const p of pieces) {
      await releasePieceFromInwardHold(p.id, { projectId: approval.project_id, bomItemId: approval.bom_item_id });
    }
    await releaseScalarFromInwardHold(approval.id);
  }

  await execute(
    "UPDATE inward_approvals SET status = ?, decided_by = ?, decided_at = CURRENT_TIMESTAMP, reason = ? WHERE id = ?",
    [b.decision, user.username, reason, approval.id]
  );
  await audit(`inward_approval_${b.decision}`, {
    actor: user.username,
    detail: `inward_approvals ${approval.id} (bom_item ${approval.bom_item_id})${reason ? ` — ${reason}` : ''}`,
  });

  try {
    await notifyDepartment('Stores', {
      kind: 'inward_approval_decided',
      title: b.decision === 'approved' ? 'Material approved — now usable stock' : 'Material rejected on inward review',
      body: reason, project_id: approval.project_id, dedupe_key: `inward_approval_decided:${approval.id}`,
    });
  } catch (err) { /* notification is best-effort */ }

  return NextResponse.json({ ok: true, status: b.decision });
}
