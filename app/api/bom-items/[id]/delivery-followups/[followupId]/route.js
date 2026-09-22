// app/api/bom-items/[id]/delivery-followups/[followupId]/route.js — delete one follow-up note.
// Same authority tier as adding one (procurement.delivery_followup.write) — a shared team log, not
// author-restricted, matching how every other collaborative note/log in this app works.
import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';

export async function DELETE(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Procurement');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Procurement', 'procurement.delivery_followup.write');
  if (actionDenied) return actionDenied;

  const row = await queryOne(
    'SELECT id FROM delivery_followups WHERE id = ? AND bom_item_id = ?',
    [params.followupId, params.id]);
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  await execute('DELETE FROM delivery_followups WHERE id = ?', [params.followupId]);
  return NextResponse.json({ ok: true });
}
