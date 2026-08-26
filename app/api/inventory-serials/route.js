// app/api/inventory-serials/route.js — Phase 2 discrete-equipment receiving (lib/inventory-serials.js).
// Mirrors app/api/stock-pieces/route.js's GET/POST shape exactly.
import { NextResponse } from 'next/server';
import { getFreshSessionUser, isInternal, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { receiveSerial, listSerials } from '@/lib/inventory-serials';
import { audit } from '@/lib/usb';

export async function GET(req) {
  const user = await getFreshSessionUser();
  if (!isInternal(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const inventoryItemId = new URL(req.url).searchParams.get('inventory_item_id');
  if (!inventoryItemId) return NextResponse.json({ error: 'inventory_item_id is required' }, { status: 400 });
  return NextResponse.json(await listSerials(Number(inventoryItemId)));
}

export async function POST(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Stores');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Stores', 'stores.inventory.write');
  if (actionDenied) return actionDenied;

  const b = await req.json();
  if (!b.inventory_item_id) {
    return NextResponse.json({ error: 'inventory_item_id is required' }, { status: 400 });
  }
  try {
    const result = await receiveSerial({
      inventoryItemId: Number(b.inventory_item_id), serialNo: b.serial_no, testCertificateId: b.test_certificate_id,
      receiptId: b.receipt_id ? Number(b.receipt_id) : undefined,
      bomItemId: b.bom_item_id ? Number(b.bom_item_id) : undefined,
      username: user.username,
    });
    await audit('inventory_serial_received', { actor: user.username, detail: result.code });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
