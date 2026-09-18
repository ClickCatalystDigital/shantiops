// app/api/settings/remnant-tolerances/route.js — category-specific matching tolerances for
// lib/remnant-match.js's auto-reservation engine. Same gating shape as allocation-mode's own route
// (GET is isInternal — Procurement/Production benefit from knowing what's configured too; write is
// Stores-gated, since Stores owns the matching engine's day-to-day behavior).
import { NextResponse } from 'next/server';
import { getFreshSessionUser, isInternal, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { getRemnantMatchTolerances, setPlateThicknessTolerance } from '@/lib/procurement';
import { audit } from '@/lib/usb';

export async function GET() {
  const user = await getFreshSessionUser();
  if (!isInternal(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  return NextResponse.json(await getRemnantMatchTolerances());
}

export async function PATCH(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Stores');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Stores', 'stores.allocation_mode.write');
  if (actionDenied) return actionDenied;

  const b = await req.json();
  if (b.plate_thickness_mm == null || !(Number(b.plate_thickness_mm) >= 0)) {
    return NextResponse.json({ error: 'plate_thickness_mm must be a non-negative number' }, { status: 400 });
  }
  const tolerances = await setPlateThicknessTolerance(b.plate_thickness_mm);
  await audit('remnant_match_tolerance_changed', { actor: user.username, detail: `plate thickness = ${b.plate_thickness_mm}mm` });
  return NextResponse.json(tolerances);
}
