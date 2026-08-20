// app/api/service-contracts/route.js — STERP item 37. Contract dates, covered equipment (the
// linked project), visit frequency, and entitlement. GET is isInternal-gated, writes are
// Installation-only, same shape as service-calls.
import { NextResponse } from 'next/server';
import { execute, nextCounterValue } from '@/lib/db';
import { getFreshSessionUser, isInternal, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { getServiceContracts } from '@/lib/data';
import { audit } from '@/lib/usb';

export async function GET() {
  const user = await getFreshSessionUser();
  if (!isInternal(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  return NextResponse.json(await getServiceContracts());
}

export async function POST(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Installation');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Installation', 'installation.contract.write');
  if (actionDenied) return actionDenied;

  const b = await req.json();
  const contractNo = await nextCounterValue('service_contract_no');
  const { lastId } = await execute(
    `INSERT INTO service_contracts
       (contract_no, project_id, customer_name, start_date, end_date, visit_frequency, entitlement, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [contractNo, b.project_id || null, b.customer_name || null, b.start_date || null, b.end_date || null,
      b.visit_frequency || null, b.entitlement || null, user.username]
  );
  await audit('service_contract_created', { actor: user.username, detail: `SVC-${contractNo}: ${b.customer_name || ''}` });
  return NextResponse.json({ id: Number(lastId), contract_no: contractNo });
}
