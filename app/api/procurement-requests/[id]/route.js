// Accept or reject a new-item procurement request (§4.0). Accepting is the acceptance gate itself:
// it materializes the request into a real bom_items row (purchase_status='PENDING'), which is what
// makes it show up anywhere in Procurement — nothing else needs to "hide" a pending request, it
// simply isn't a BOM row yet. Rejecting just closes it out, no BOM row is ever created.
import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getSessionUser, requireDepartment } from '@/lib/auth';
import { audit } from '@/lib/usb';

export async function PATCH(req, { params }) {
  const user = getSessionUser();
  const denied = requireDepartment(user, 'Procurement');
  if (denied) return denied;

  const request = await queryOne('SELECT * FROM procurement_requests WHERE id = ?', [params.id]);
  if (!request) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (request.status !== 'pending') return NextResponse.json({ error: 'Already resolved' }, { status: 400 });

  const b = await req.json();
  if (b.action === 'accept') {
    const { lastId } = await execute(
      `INSERT INTO bom_items (project_id, material_description, moc, size_spec, qty_text, pr_ref, purchase_status)
       VALUES (?, ?, ?, ?, ?, ?, 'PENDING')`,
      [request.project_id, request.material_description, request.moc, request.size_spec, request.qty_text, request.pr_ref]
    );
    const bomItemId = Number(lastId);
    await execute(
      `UPDATE procurement_requests
          SET status = 'accepted', accepted_by = ?, bom_item_id = ?, resolved_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
      [user.username, bomItemId, request.id]
    );
    await audit('procurement_request_accepted', {
      actor: user.username, detail: `${request.material_description} -> bom_item ${bomItemId}`,
    });
    return NextResponse.json({ ok: true, bom_item_id: bomItemId });
  }

  if (b.action === 'reject') {
    await execute(
      "UPDATE procurement_requests SET status = 'rejected', accepted_by = ?, resolved_at = CURRENT_TIMESTAMP WHERE id = ?",
      [user.username, request.id]
    );
    await audit('procurement_request_rejected', { actor: user.username, detail: request.material_description });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
