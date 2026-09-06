// Multi-unit split — architecture review addition. QC's bulk certificate-assignment write, at the
// (master bom_item, child unit) cell grain, the same key shape bom_item_child_routing already uses.
// params.id is the MASTER project — a natural sibling of the existing read route one level up
// (app/api/projects/[id]/child-routing/route.js), which already exposes this data (with
// certificates attached, once getChildRoutingBoard() carries them) to any internal user.
//
// Never trusts the client's cell list: every submitted (bom_item_id, child_project_id) pair is
// checked against a fresh getChildRoutingBoard(master.id) call, the same defensive-re-derivation
// discipline app/api/bom-items/[id]/route-to/route.js already applies for routing decisions.
// Membership in board.cells IS "a real allocated cell belonging to this master," since
// getChildRoutingBoard() only ever emits cells with allocated > 0.
//
// No silent drops — every submitted cell is classified and reported back (assigned /
// already_linked / not_allocated), matching app/api/packing/batch-children/route.js's own
// created/skipped precedent, extended with a reason per skip since a bulk submission here can span
// hundreds of cells and the caller needs to know exactly which ones didn't apply, not just a count.
import { NextResponse } from 'next/server';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { execute, queryOne } from '@/lib/db';
import { audit } from '@/lib/usb';
import { getChildRoutingBoard } from '@/lib/data';

export async function POST(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'QC');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'QC', 'qc.certificate.write');
  if (actionDenied) return actionDenied;

  const master = await queryOne('SELECT id FROM projects WHERE id = ?', [params.id]);
  if (!master) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const b = await req.json();
  const certificateId = Number(b.certificate_id) || null;
  if (!certificateId) return NextResponse.json({ error: 'certificate_id is required' }, { status: 400 });
  const cert = await queryOne('SELECT id, certificate_no FROM test_certificates WHERE id = ?', [certificateId]);
  if (!cert) return NextResponse.json({ error: 'Certificate not found' }, { status: 404 });

  const cells = Array.isArray(b.cells) ? b.cells : [];
  if (!cells.length) return NextResponse.json({ error: 'Pick at least one item/unit cell' }, { status: 400 });

  const board = await getChildRoutingBoard(master.id);
  const boardByKey = new Map(board.cells.map(c => [`${c.bom_item_id}:${c.child_project_id}`, c]));

  let assigned = 0;
  const skipped = [];
  for (const raw of cells) {
    const bomItemId = Number(raw?.bom_item_id) || null;
    const childProjectId = Number(raw?.child_project_id) || null;
    const cell = bomItemId && childProjectId ? boardByKey.get(`${bomItemId}:${childProjectId}`) : null;
    if (!cell) {
      skipped.push({ bom_item_id: bomItemId, child_project_id: childProjectId, reason: 'not_allocated' });
      continue;
    }
    if (cell.certificates.some(c => c.id === certificateId)) {
      skipped.push({ bom_item_id: bomItemId, child_project_id: childProjectId, reason: 'already_linked' });
      continue;
    }
    await execute(
      `INSERT OR IGNORE INTO bom_item_child_certificates (bom_item_id, child_project_id, certificate_id, linked_by)
       VALUES (?, ?, ?, ?)`,
      [bomItemId, childProjectId, certificateId, user.username]);
    assigned++;
  }

  await audit('bom_item_child_certificate_linked', {
    actor: user.username,
    detail: `certificate #${certificateId} (${cert.certificate_no}) -> ${assigned} cell(s) for master ${master.id}${skipped.length ? `, ${skipped.length} skipped` : ''}`,
  });
  return NextResponse.json({ ok: true, assigned, skipped });
}

export async function DELETE(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'QC');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'QC', 'qc.certificate.write');
  if (actionDenied) return actionDenied;

  const master = await queryOne('SELECT id FROM projects WHERE id = ?', [params.id]);
  if (!master) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const b = await req.json();
  const bomItemId = Number(b.bom_item_id) || null;
  const childProjectId = Number(b.child_project_id) || null;
  const certificateId = Number(b.certificate_id) || null;
  if (!bomItemId || !childProjectId || !certificateId) {
    return NextResponse.json({ error: 'bom_item_id, child_project_id and certificate_id are required' }, { status: 400 });
  }

  // Same trust boundary as the write path — confirm the link actually belongs to this master
  // (through its own bom_item and child) before deleting anything.
  const owned = await queryOne(
    `SELECT bcc.id FROM bom_item_child_certificates bcc
       JOIN bom_items b ON b.id = bcc.bom_item_id
       JOIN projects c ON c.id = bcc.child_project_id
      WHERE bcc.bom_item_id = ? AND bcc.child_project_id = ? AND bcc.certificate_id = ?
        AND b.project_id = ? AND c.master_project_id = ?`,
    [bomItemId, childProjectId, certificateId, master.id, master.id]);
  if (!owned) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  await execute('DELETE FROM bom_item_child_certificates WHERE id = ?', [owned.id]);
  await audit('bom_item_child_certificate_unlinked', {
    actor: user.username,
    detail: `certificate #${certificateId} removed from bom_item #${bomItemId} / child #${childProjectId}`,
  });
  return NextResponse.json({ ok: true });
}
