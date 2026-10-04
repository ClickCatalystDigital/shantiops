// Undo a handover — pulls the item back off a draft packing list; refused once that list is packed.
import { NextResponse } from 'next/server';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { queryOne, execute } from '@/lib/db';
import { audit } from '@/lib/usb';
import { removeBomItemFromDraftLists } from '@/lib/packing-generate';
import { getHandoverLines, syncProductionDone } from '@/lib/production-handover';

export async function DELETE(_req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Production');
  if (denied) return denied;
  const h = await queryOne('SELECT * FROM production_handovers WHERE id = ?', [params.id]);
  if (!h) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  // The handover put the item on the project's draft packing list: take it back off. Refused once
  // any list carrying it has moved past draft (packed, under review, dispatched).
  const bom = await queryOne('SELECT project_id FROM bom_items WHERE id = ?', [h.bom_item_id]);
  const off = await removeBomItemFromDraftLists(h.bom_item_id, h.child_project_id || bom.project_id);
  if (off.blocked) return NextResponse.json({ error: 'Its packing list has already been packed. Dispatch has to take it off first.' }, { status: 409 });
  await execute('DELETE FROM production_handovers WHERE id = ?', [params.id]);
  if (!h.child_project_id) {
    const line = (await getHandoverLines()).find(l => l.bom_item_id === h.bom_item_id && !l.unit_project_id);
    await syncProductionDone(h.bom_item_id, line?.required_qty || 0);
  }
  await audit('production_handover_undo', { actor: user.username, detail: JSON.stringify({ id: h.id, bom_item_id: h.bom_item_id, qty: h.qty }) });
  return NextResponse.json({ ok: true });
}
