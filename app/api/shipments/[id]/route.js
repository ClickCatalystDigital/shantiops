// One shipment: add / remove lists, set the vehicle (optionally on every list), split it up again.
import { NextResponse } from 'next/server';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { execute, queryAll, queryOne } from '@/lib/db';
import { audit } from '@/lib/usb';
import { checkCombinable } from '@/lib/shipments.mjs';
import { cleanTrackingUrl, TRANSPORT_MODES } from '@/lib/carrier.mjs';

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
  // Once every list has left, the shipment's make-up is a historic record: no add / take out / split.
  // Carrier and tracking details stay editable (an LR number often arrives after the truck has left).
  // A list that has already left stays in the shipment while others are still to go.
  const memberStatus = (await queryAll('SELECT status FROM packing_lists WHERE shipment_id = ?', [sh.id])).map(r => r.status);
  const structural = ['add', 'remove', 'split'].includes(b.action);
  if (structural && memberStatus.length && memberStatus.every(x => x === 'dispatched')) {
    return NextResponse.json({ error: `${sh.shipment_no} is fully dispatched. Its lists can't be changed any more.` }, { status: 409 });
  }
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
    if (l.status === 'dispatched') return NextResponse.json({ error: `${l.packing_no} has already been dispatched with this shipment and can't be taken out.` }, { status: 409 });
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
    const t = cleanTrackingUrl(b.tracking_url);
    if (t.error) return NextResponse.json({ error: t.error }, { status: 400 });
    const mode = TRANSPORT_MODES.some(([v]) => v === b.transport_mode) ? b.transport_mode : null;
    const v = {
      vehicle_no: text(b.vehicle_no), dispatch_through: text(b.dispatch_through), carrier_doc_no: text(b.carrier_doc_no),
      carrier_doc_date: text(b.carrier_doc_date), container_no: text(b.container_no), tracking_url: t.value,
      expected_delivery_date: text(b.expected_delivery_date),
    };
    const cols = Object.keys(v);
    await execute(`UPDATE shipments SET ${cols.map(c => `${c} = ?`).join(', ')} WHERE id = ?`, [...cols.map(c => v[c]), sh.id]);
    if (b.apply) {
      // Carrier details are business records: every list in the shipment gets them, dispatched or not.
      const sets = [...cols.map(c => `${c} = ?`), ...(mode ? ['transport_mode = ?'] : [])];
      await execute(`UPDATE packing_lists SET ${sets.join(', ')} WHERE shipment_id = ?`, [...cols.map(c => v[c]), ...(mode ? [mode] : []), sh.id]);
    }
    await audit('shipment_transport', { actor: user.username, detail: `${sh.shipment_no} · ${v.vehicle_no || '-'} · ${v.carrier_doc_no || '-'}${b.apply ? ' (applied to all lists)' : ''}` });
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
    if (memberStatus.includes('dispatched')) return NextResponse.json({ error: 'Some lists have already been dispatched with this shipment, so it can no longer be split up.' }, { status: 409 });
    await execute('UPDATE packing_lists SET shipment_id = NULL WHERE shipment_id = ?', [sh.id]);
    await execute("UPDATE shipments SET status = 'split', split_at = CURRENT_TIMESTAMP WHERE id = ?", [sh.id]);
    await audit('shipment_split', { actor: user.username, detail: sh.shipment_no });
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
