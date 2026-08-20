// app/api/gate-inward-receipts/route.js — STERP item 14. Formal Gate Inward Receipt: vehicle,
// supplier, driver, entry time, material reference, and a security check, logged the moment
// something physically enters — before/independent of any GRN. GET is isInternal-gated (same
// reasoning as inventory-items' GET — other departments may need to see what's arrived), writes
// are Stores-only.
import { NextResponse } from 'next/server';
import { execute, nextCounterValue } from '@/lib/db';
import { getFreshSessionUser, isInternal, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { getGateInwardReceipts } from '@/lib/data';
import { audit } from '@/lib/usb';

export async function GET() {
  const user = await getFreshSessionUser();
  if (!isInternal(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  return NextResponse.json(await getGateInwardReceipts());
}

export async function POST(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Stores');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Stores', 'stores.gir.write');
  if (actionDenied) return actionDenied;

  const b = await req.json();
  if (!String(b.vehicle_no || '').trim() && !String(b.supplier_name || '').trim()) {
    return NextResponse.json({ error: 'Enter at least a vehicle number or a supplier' }, { status: 400 });
  }
  const girNo = await nextCounterValue('gir_no');
  const { lastId } = await execute(
    `INSERT INTO gate_inward_receipts
       (gir_no, vehicle_no, supplier_name, driver_name, material_ref,
        security_seal_ok, security_docs_ok, security_remarks, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [girNo, b.vehicle_no || null, b.supplier_name || null, b.driver_name || null, b.material_ref || null,
      b.security_seal_ok ? 1 : 0, b.security_docs_ok ? 1 : 0, b.security_remarks || null, user.username]
  );
  await audit('gir_created', { actor: user.username, detail: `GIR-${girNo}: ${b.supplier_name || ''} / ${b.vehicle_no || ''}` });
  return NextResponse.json({ id: Number(lastId), gir_no: girNo });
}
