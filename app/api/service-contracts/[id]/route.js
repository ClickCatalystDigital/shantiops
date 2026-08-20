// app/api/service-contracts/[id]/route.js — field edits, plus the three real status actions:
// renew (inserts a new contract row linked via renewed_from_id and retires this one), cancel, and
// expire. Renewing never mutates the old row — same "record what happened" idiom as
// gate_inward_receipts/gate_passes elsewhere in this file's sibling routes.
import { NextResponse } from 'next/server';
import { execute, queryOne, nextCounterValue } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { audit } from '@/lib/usb';

const EDITABLE_FIELDS = ['customer_name', 'start_date', 'end_date', 'visit_frequency', 'entitlement'];

export async function PATCH(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Installation');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Installation', 'installation.contract.write');
  if (actionDenied) return actionDenied;

  const contract = await queryOne('SELECT * FROM service_contracts WHERE id = ?', [params.id]);
  if (!contract) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const b = await req.json();

  if (b.action === 'renew') {
    if (contract.status !== 'active' && contract.status !== 'expired') {
      return NextResponse.json({ error: `Cannot renew from ${contract.status}` }, { status: 409 });
    }
    const contractNo = await nextCounterValue('service_contract_no');
    const { lastId } = await execute(
      `INSERT INTO service_contracts
         (contract_no, project_id, customer_name, start_date, end_date, visit_frequency, entitlement,
          renewed_from_id, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [contractNo, contract.project_id, contract.customer_name, b.start_date || null, b.end_date || null,
        b.visit_frequency || contract.visit_frequency, b.entitlement || contract.entitlement, contract.id, user.username]
    );
    await execute("UPDATE service_contracts SET status = 'renewed' WHERE id = ?", [params.id]);
    await audit('service_contract_renewed', { actor: user.username, detail: `SVC-${contract.contract_no} -> SVC-${contractNo}` });
    return NextResponse.json({ id: Number(lastId), contract_no: contractNo });
  }

  if (b.action === 'cancel' || b.action === 'expire') {
    const to = b.action === 'cancel' ? 'cancelled' : 'expired';
    await execute('UPDATE service_contracts SET status = ? WHERE id = ?', [to, params.id]);
    await audit('service_contract_' + b.action, { actor: user.username, detail: `SVC-${contract.contract_no} -> ${to}` });
    return NextResponse.json({ ok: true });
  }

  const sets = [];
  const args = [];
  for (const f of EDITABLE_FIELDS) {
    if (f in b) { sets.push(`${f} = ?`); args.push(b[f] || null); }
  }
  if (!sets.length) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
  args.push(params.id);
  await execute(`UPDATE service_contracts SET ${sets.join(', ')} WHERE id = ?`, args);
  await audit('service_contract_updated', { actor: user.username, detail: `SVC-${contract.contract_no}: ${Object.keys(b).join(',')}` });
  return NextResponse.json({ ok: true });
}
