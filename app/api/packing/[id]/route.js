import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { audit } from '@/lib/usb';
import { syncPackingMilestone } from '@/lib/milestone-auto';

const EDITABLE = ['customer_name', 'customer_address', 'invoice_no', 'invoice_date', 'package_type',
  'dc_no', 'dc_date', 'vehicle_no', 'dispatch_through', 'contact_person', 'status'];
// Same idiom as bom-items PATCH's PURCHASE_STATUSES check / qc-records' pass|fail|pending check.
const PACKING_STATUSES = ['draft', 'packed', 'dispatched'];

export async function PATCH(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Dispatch');
  if (denied) return denied;
  const b = await req.json();
  if ('status' in b && !PACKING_STATUSES.includes(b.status)) {
    return NextResponse.json({ error: `Unknown status: ${b.status}` }, { status: 400 });
  }
  if ('status' in b) {
    const actionDenied = await requireAction(user, 'Dispatch', 'dispatch.packing.status');
    if (actionDenied) return actionDenied;
  }
  if (Object.keys(b).some(k => k !== 'status')) {
    const actionDenied = await requireAction(user, 'Dispatch', 'dispatch.packing.edit');
    if (actionDenied) return actionDenied;
  }
  const sets = [];
  const args = [];
  for (const f of EDITABLE) {
    if (f in b) { sets.push(`${f} = ?`); args.push(b[f] === '' ? null : b[f]); }
  }
  if (!sets.length) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
  sets.push('updated_at = CURRENT_TIMESTAMP');
  args.push(params.id);
  await execute(`UPDATE packing_lists SET ${sets.join(', ')} WHERE id = ?`, args);
  // Status is the meaningful transition (Pending → Ready → Dispatched) — worth its own audit action.
  if ('status' in b) {
    await audit('packing_status_change', { actor: user.username, detail: `list ${params.id} -> ${b.status}` });
    if (b.status === 'packed' || b.status === 'dispatched') {
      const pl = await queryOne('SELECT project_id FROM packing_lists WHERE id = ?', [params.id]);
      if (pl?.project_id) await syncPackingMilestone(pl.project_id, user.username);
    }
  }
  return NextResponse.json({ ok: true });
}
