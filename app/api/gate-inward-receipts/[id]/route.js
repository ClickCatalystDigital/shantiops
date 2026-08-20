// app/api/gate-inward-receipts/[id]/route.js — close a GIR and/or attach the GRN reference once
// material has actually been received. Deliberately just these two fields, not a generic
// field-PATCH — the rest of a GIR (vehicle/supplier/driver/entry) is fixed at log time, same
// "record what happened, don't rewrite it" spirit as bom_items.received_ref.
import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { audit } from '@/lib/usb';

export async function PATCH(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Stores');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Stores', 'stores.gir.write');
  if (actionDenied) return actionDenied;

  const gir = await queryOne('SELECT * FROM gate_inward_receipts WHERE id = ?', [params.id]);
  if (!gir) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const b = await req.json();
  if (b.close) {
    if (gir.status === 'closed') return NextResponse.json({ error: 'Already closed' }, { status: 409 });
    if (!(b.grn_ref || gir.grn_ref)) {
      return NextResponse.json({ error: 'Attach a GRN reference before closing — this GIR has none' }, { status: 400 });
    }
  }
  const sets = [];
  const args = [];
  if ('grn_ref' in b) { sets.push('grn_ref = ?'); args.push(b.grn_ref || null); }
  if (b.close) { sets.push("status = 'closed'"); }
  if (!sets.length) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
  args.push(params.id);

  await execute(`UPDATE gate_inward_receipts SET ${sets.join(', ')} WHERE id = ?`, args);
  await audit('gir_updated', { actor: user.username, detail: `GIR-${gir.gir_no}: ${Object.keys(b).join(',')}` });
  return NextResponse.json({ ok: true });
}
