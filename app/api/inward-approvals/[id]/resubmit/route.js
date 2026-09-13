// Inward QC/Production Approval Workflow — resubmission. Gated identically to decide/route.js
// (requireAction(user,'QC','qc.inward.decide')), no new action key: QC Head is the only role that
// can trigger an inward resubmission, the same person/department who rejected it reopening the
// review once whatever they flagged has been addressed. A deliberate simplification, not an
// invented new authority — see the plan doc's "Resubmit authority" note. Stock is untouched here —
// the held pieces/scalar quantity are still sitting exactly where the original rejected receipt
// left them; only a fresh approve actually releases them.
import { NextResponse } from 'next/server';
import { getFreshSessionUser } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { execute, queryOne } from '@/lib/db';
import { notifyInwardApprovalPending } from '@/lib/bom-receiving';
import { audit } from '@/lib/usb';

export async function POST(req, { params }) {
  const user = await getFreshSessionUser();
  const actionDenied = await requireAction(user, 'QC', 'qc.inward.decide');
  if (actionDenied) return actionDenied;

  const prior = await queryOne('SELECT * FROM inward_approvals WHERE id = ?', [params.id]);
  if (!prior) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (prior.status !== 'rejected') {
    return NextResponse.json({ error: 'Only a rejected review can be resubmitted' }, { status: 400 });
  }

  const { lastId } = await execute(
    `INSERT INTO inward_approvals (bom_item_receipt_id, bom_item_id, project_id, inventory_item_id, qty_scalar, resubmission_of_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [prior.bom_item_receipt_id, prior.bom_item_id, prior.project_id, prior.inventory_item_id, prior.qty_scalar, prior.id]
  );
  const item = await queryOne('SELECT material_description, project_id FROM bom_items WHERE id = ?', [prior.bom_item_id]);
  await notifyInwardApprovalPending(item, Number(lastId));
  await audit('inward_approval_resubmitted', { actor: user.username, detail: `inward_approvals ${prior.id} -> ${lastId}` });
  return NextResponse.json({ ok: true, id: Number(lastId) });
}
