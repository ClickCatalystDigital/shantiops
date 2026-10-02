// app/api/packing/[id]/convert-layout/route.js — turn an old-layout packing list into the combined
// layout (packing groups, assemblies, continuous S.No). Draft/ready lists only. See convertListToCombined.
import { NextResponse } from 'next/server';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { convertListToCombined } from '@/lib/packing-generate';
import { audit } from '@/lib/usb';

export async function POST(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Dispatch');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Dispatch', 'dispatch.packing.edit');
  if (actionDenied) return actionDenied;
  try {
    const r = await convertListToCombined(Number(params.id), user);
    await audit('packing_layout_converted', { actor: user.username, detail: `list ${params.id} -> combined (${r.items} lines)` });
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 500 });
  }
}
