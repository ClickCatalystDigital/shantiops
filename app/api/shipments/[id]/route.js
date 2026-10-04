// One shipment: add / remove lists, set the vehicle (optionally on every list), split it up again.
import { NextResponse } from 'next/server';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { execute, queryAll, queryOne } from '@/lib/db';
import { audit } from '@/lib/usb';
import { checkCombinable } from '@/lib/shipments.mjs';

const LIST_COLS = 'id, packing_no, customer_name, customer_address, status, shipment_id, company';

export async function PATCH(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Dispatch');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Dispatch', 'dispatch.packing.edit');
  if (actionDenied) return actionDenied;
  const sh = await queryOne("SELECT * FROM shipments WHERE id = ? AND status = 'open'", [params.id]);
  if (!sh) return NextResponse.json({ error: 'Shipment not found' }, { status: 404 });
  const b = await req.json();
  const text = v => (typeof v === 'string' && v.trim() ? v.trim() : null);

  if (b.action === 'add') {
    const ids = [...new Set((Array.isArray(b.list_ids) ? b.list_ids : []).map(Number).filter(Boolean))];
    if (!ids.length) return NextResponse.json({ error: 'Pick a packing list' }, { status: 400 });
    const members = await queryAll(`SELECT ${LIST_COLS} FROM packing_lists WHERE shipment_id = ?`, [sh.id]);
    const adding = await queryAll(`SELECT ${LIST_COLS} FROM packing_lists WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
    if (adding.length !== ids.length) return NextResponse.json({ error: 'One of the packing lists was not found' }, { status: 404 });
    const check = checkCombinable([...members, ...adding.filter(a => !members.some(m => m.id === a.id))], sh.id);
    if (!check.ok) return NextResponse.json({ error: check.problems.join(' ') }, { status: 400 });
    await execute(`UPDATE packing_lists SET shipment_id = ? WHERE id IN (${ids.map(() => '?').join(',')})`, [sh.id, ...ids]);
    await audit('shipment_lists_added', { actor: user.username, detail: `${sh.shipment_no} + ${adding.map(a => a.packing_no).join(', ')}` });
    return NextResponse.json({ ok: true, warnings: check.warnings });
  }

  if (b.action === 'remove') {
    const l = await queryOne('SELECT id, packing_no, status FROM packing_lists WHERE id = ? AND shipment_id = ?', [b.list_id, sh.id]);
    if (!l) return NextResponse.json({ error: 'That list is not in this shipment' }, { status: 404 });
    await execute('UPDATE packing_lists SET shipment_id = NULL WHERE id = ?', [l.id]);
    const left = await queryOne('SELECT COUNT(*) AS n FROM packing_lists WHERE shipment_id = ?', [sh.id]);
    if (Number(left.n) < 2) { // a shipment of one list is just a list: dissolve it
      await execute('UPDATE packing_lists SET shipment_id = NULL WHERE shipment_id = ?', [sh.id]);
      await execute("UPDATE shipments SET status = 'split', split_at = CURRENT_TIMESTAMP WHERE id = ?", [sh.id]);
    }
    await audit('shipment_list_removed', { actor: user.username, detail: `${sh.shipment_no} - ${l.packing_no}` });
    return NextResponse.json({ ok: true, dissolved: Number(left.n) < 2 });
  }

  if (b.action === 'transport') {
    const vehicle = text(b.vehicle_no), through = text(b.dispatch_through);
    await execute('UPDATE shipments SET vehicle_no = ?, dispatch_through = ? WHERE id = ?', [vehicle, through, sh.id]);
    if (b.apply) {
      // Every list that has not left yet gets the same vehicle (a dispatched list is a finished record).
      await execute("UPDATE packing_lists SET vehicle_no = ?, dispatch_through = ? WHERE shipment_id = ? AND status != 'dispatched'", [vehicle, through, sh.id]);
    }
    await audit('shipment_transport', { actor: user.username, detail: `${sh.shipment_no} · ${vehicle || '-'}${b.apply ? ' (applied to all lists)' : ''}` });
    return NextResponse.json({ ok: true });
  }

  if (b.action === 'consolidated_ewb') {
    // Capture only (no NIC link yet): the consolidated e-way bill number a transporter raises when one
    // vehicle carries several e-way bills. 12 digits, or blank to clear.
    const no = text(b.consolidated_eway_bill_no);
    if (no && !/^\d{12}$/.test(no)) return NextResponse.json({ error: 'A consolidated e-way bill number is 12 digits' }, { status: 400 });
    await execute('UPDATE shipments SET consolidated_eway_bill_no = ? WHERE id = ?', [no, sh.id]);
    await audit('shipment_consolidated_ewb', { actor: user.username, detail: `${sh.shipment_no} · ${no || 'cleared'}` });
    return NextResponse.json({ ok: true });
  }

  if (b.action === 'split') {
    await execute('UPDATE packing_lists SET shipment_id = NULL WHERE shipment_id = ?', [sh.id]);
    await execute("UPDATE shipments SET status = 'split', split_at = CURRENT_TIMESTAMP WHERE id = ?", [sh.id]);
    await audit('shipment_split', { actor: user.username, detail: sh.shipment_no });
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
