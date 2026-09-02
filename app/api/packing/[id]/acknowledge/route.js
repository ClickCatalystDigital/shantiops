// app/api/packing/[id]/acknowledge/route.js — Delivery acknowledgment (Feature D). A separate,
// explicit action, not a side effect of the generic PATCH — same "distinct real-world authority
// moment gets its own route" precedent as the freight-posting route right next to this one.
// Immutable after first capture: once delivery_ack_status is set, this route refuses a second call,
// full stop — a correction is a fresh manual/admin note, never a re-edit of this record.
import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { audit } from '@/lib/usb';

const STATUSES = ['accepted', 'damaged', 'discrepancy'];

export async function POST(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Dispatch');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Dispatch', 'dispatch.packing.acknowledge');
  if (actionDenied) return actionDenied;

  const list = await queryOne('SELECT status, delivery_ack_status FROM packing_lists WHERE id = ?', [params.id]);
  if (!list) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (list.status !== 'dispatched') {
    return NextResponse.json({ error: 'Only a dispatched packing list can be acknowledged' }, { status: 400 });
  }
  if (list.delivery_ack_status) {
    return NextResponse.json({ error: 'Already acknowledged — this record is immutable' }, { status: 409 });
  }

  const b = await req.json();
  if (!STATUSES.includes(b.status)) {
    return NextResponse.json({ error: `status must be one of: ${STATUSES.join(', ')}` }, { status: 400 });
  }

  // The immutability guard folded into the WHERE clause itself, not just the pre-check above (gap
  // found in review — the pre-check alone leaves a race window where two concurrent acknowledge
  // calls could both pass it and the second write would silently overwrite the first).
  const upd = await execute(
    `UPDATE packing_lists SET delivery_ack_status = ?, delivery_ack_notes = ?, delivery_ack_at = CURRENT_TIMESTAMP, delivery_ack_by = ?
      WHERE id = ? AND delivery_ack_status IS NULL`,
    [b.status, b.notes ? String(b.notes).trim() : null, user.username, params.id]
  );
  if (upd.changes !== 1) {
    return NextResponse.json({ error: 'Already acknowledged — this record is immutable' }, { status: 409 });
  }
  await audit('packing_delivery_ack', { actor: user.username, detail: `list ${params.id} -> ${b.status}` });
  // Return the actual stamped row rather than a bare {ok:true} — the client's optimistic update
  // uses these verbatim instead of guessing a timestamp shape/actor, which is what caused the
  // "Invalid Date · " display bug (a client-built ISO string doesn't match formatDate()'s expected
  // SQLite-style CURRENT_TIMESTAMP shape, and the acting user was never sent at all).
  const saved = await queryOne(
    'SELECT delivery_ack_status, delivery_ack_notes, delivery_ack_at, delivery_ack_by FROM packing_lists WHERE id = ?',
    [params.id]
  );
  return NextResponse.json({ ok: true, ...saved });
}
