// Shipments: group packing lists that leave together. GET = open shipments; POST = combine lists.
import { NextResponse } from 'next/server';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { execute, queryAll, nextNumber } from '@/lib/db';
import { audit } from '@/lib/usb';
import { getShipments } from '@/lib/data';
import { checkCombinable } from '@/lib/shipments.mjs';

export async function GET() {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Dispatch');
  if (denied) return denied;
  return NextResponse.json(await getShipments());
}

export async function POST(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Dispatch');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Dispatch', 'dispatch.packing.edit');
  if (actionDenied) return actionDenied;
  const b = await req.json();
  const ids = [...new Set((Array.isArray(b.list_ids) ? b.list_ids : []).map(Number).filter(Boolean))];
  const lists = ids.length ? await queryAll(`SELECT id, packing_no, customer_name, customer_address, status, shipment_id, company, vehicle_no, dispatch_through FROM packing_lists WHERE id IN (${ids.map(() => '?').join(',')})`, ids) : [];
  if (lists.length !== ids.length) return NextResponse.json({ error: 'One of the packing lists was not found' }, { status: 404 });
  const check = checkCombinable(lists);
  if (!check.ok) return NextResponse.json({ error: check.problems.join(' ') }, { status: 400 });

  const text = v => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const first = lists[0];
  const shipment_no = await nextNumber('shipment_no', 'SHP');
  const r = await execute(
    `INSERT INTO shipments (shipment_no, customer_name, customer_address, vehicle_no, dispatch_through, note, created_by) VALUES (?,?,?,?,?,?,?)`,
    [shipment_no, first.customer_name, lists.map(l => l.customer_address).find(Boolean) || null, text(b.vehicle_no), text(b.dispatch_through), text(b.note), user.username]);
  const id = Number(r.lastId);
  await execute(`UPDATE packing_lists SET shipment_id = ? WHERE id IN (${ids.map(() => '?').join(',')})`, [id, ...ids]);
  if (text(b.vehicle_no) || text(b.dispatch_through)) {
    await execute(
      `UPDATE packing_lists SET vehicle_no = COALESCE(?, vehicle_no), dispatch_through = COALESCE(?, dispatch_through) WHERE id IN (${ids.map(() => '?').join(',')})`,
      [text(b.vehicle_no), text(b.dispatch_through), ...ids]);
  }
  await audit('shipment_created', { actor: user.username, detail: `${shipment_no} · ${lists.map(l => l.packing_no).join(', ')}` });
  return NextResponse.json({ ok: true, id, shipment_no, warnings: check.warnings });
}
