// app/api/settings/allocation-mode/route.js — the one persisted setting behind Stores'
// ReservationModeToggle. GET is isInternal (Procurement/Sales benefit from knowing which mode is
// active too, same reasoning as inventory-items' GET); write is Stores-gated.
import { NextResponse } from 'next/server';
import { getFreshSessionUser, isInternal, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { getAllocationMode, setAllocationMode } from '@/lib/procurement';
import { audit } from '@/lib/usb';

export async function GET() {
  const user = await getFreshSessionUser();
  if (!isInternal(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  return NextResponse.json({ mode: await getAllocationMode() });
}

export async function PATCH(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Stores');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Stores', 'stores.allocation_mode.write');
  if (actionDenied) return actionDenied;

  const b = await req.json();
  if (!['auto', 'manual'].includes(b.mode)) return NextResponse.json({ error: 'mode must be auto or manual' }, { status: 400 });
  const mode = await setAllocationMode(b.mode);
  await audit('allocation_mode_changed', { actor: user.username, detail: mode });
  return NextResponse.json({ mode });
}
