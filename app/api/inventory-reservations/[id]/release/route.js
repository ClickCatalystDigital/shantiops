// app/api/inventory-reservations/[id]/release/route.js — V2-CHANGES.md Group 6 Phase 6.3. Frees a
// reservation's qty back into `available` without touching on_hand (nothing was decremented yet).
import { NextResponse } from 'next/server';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { releaseReservation } from '@/lib/procurement';
import { audit } from '@/lib/usb';

export async function POST(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Stores');
  if (denied) return denied;

  try {
    const res = await releaseReservation(Number(params.id));
    await audit('inventory_reservation_released', {
      actor: user.username, detail: `reservation ${res.id}: bom_item ${res.bom_item_id} released, qty ${res.qty} back to available`,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
