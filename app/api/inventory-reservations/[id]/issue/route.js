// app/api/inventory-reservations/[id]/issue/route.js — V2-CHANGES.md Group 6 Phase 6.3 (D9). The
// actual "confirm" moment: Stores hands the material out, on_hand decrements, item -> In-Stock.
import { NextResponse } from 'next/server';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { issueReservation } from '@/lib/procurement';
import { audit } from '@/lib/usb';

export async function POST(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Stores');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Stores', 'stores.reservation.issue');
  if (actionDenied) return actionDenied;

  try {
    const b = await req.json().catch(() => ({}));
    const res = await issueReservation(Number(params.id), { username: user.username, jobCardId: b.job_card_id ? Number(b.job_card_id) : undefined });
    await audit('inventory_reservation_issued', {
      actor: user.username, detail: `reservation ${res.id}: bom_item ${res.bom_item_id} -> In-Stock, on_hand -${res.qty}`,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
