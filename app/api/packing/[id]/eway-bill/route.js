// app/api/packing/[id]/eway-bill/route.js — the "Generate E-Way Bill" trigger, same explicit-
// action shape as ../freight/route.js. Idempotency guard mirrors that route's idea (check before
// write): eway_bill_no IS NOT NULL is the "already done" signal here, since there's no
// journal_entries-style existing-entry check to lean on for this one.
//
// Real-NIC-API research plan, Gaps 1-4: fails closed on every prerequisite BEFORE ever calling
// generateEwayBill() — never send NIC a partially-correct payload and let its own error codes
// (216 Invalid HSN, 221 Invalid Approximate Distance, etc.) be the first sign something was wrong.
import { NextResponse } from 'next/server';
import { execute, queryOne, queryAll } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { generateEwayBill, loadCredentials } from '@/lib/eway-bill';

export async function POST(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Dispatch');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Dispatch', 'dispatch.packing.eway_bill.generate');
  if (actionDenied) return actionDenied;

  const list = await queryOne(
    `SELECT pl.id, pl.packing_no, pl.eway_bill_no, pl.transport_distance_km, pl.transport_mode,
            pl.vehicle_type, p.company, p.customer_id
       FROM packing_lists pl LEFT JOIN projects p ON p.id = pl.project_id WHERE pl.id = ?`,
    [params.id]
  );
  if (!list) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (list.eway_bill_no) {
    return NextResponse.json({ error: 'An e-way bill is already set on this packing list. Regeneration/cancellation isn’t built yet — edit the field directly if this is a correction.' }, { status: 409 });
  }
  if (!list.company) return NextResponse.json({ error: 'This packing list has no project/company linked — cannot generate.' }, { status: 400 });

  // Gap 1/3 — distance and transport mode/vehicle type are hard NIC requirements with no natural
  // default this app can invent; the UI pre-fills mode/vehicle-type but distance always needs a
  // real Dispatch entry.
  if (!list.transport_distance_km) {
    return NextResponse.json({ error: 'Enter the transport distance in km before generating an e-way bill.' }, { status: 400 });
  }
  if (list.transport_distance_km > 4000) {
    return NextResponse.json({ error: 'Transport distance cannot exceed 4000 km (NIC’s own limit).' }, { status: 400 });
  }
  if (!list.transport_mode || !list.vehicle_type) {
    return NextResponse.json({ error: 'Set the transport mode and vehicle type before generating an e-way bill.' }, { status: 400 });
  }

  // Gap 4 — NIC needs structured GSTIN/state/pincode/address, not the free-text customer_name this
  // app displays elsewhere. Fail closed rather than sending an incomplete toGstin/toPincode.
  if (!list.customer_id) {
    return NextResponse.json({ error: 'This project has no linked customer record — link one before generating an e-way bill.' }, { status: 400 });
  }
  const customer = await queryOne('SELECT gst_no, state_code, pin_code, address FROM customers WHERE id = ?', [list.customer_id]);
  const missingCustomerFields = ['gst_no', 'state_code', 'pin_code', 'address'].filter(f => !customer?.[f]);
  if (missingCustomerFields.length) {
    return NextResponse.json({ error: `The linked customer record is missing: ${missingCustomerFields.join(', ')} — fill these in before generating an e-way bill.` }, { status: 400 });
  }

  // Gap 2 — every shipped line needs a real HSN code. bom_items has no hsn_code of its own worth
  // trusting blindly (a new, mostly-unpopulated column) so the BOM line's own value is checked
  // first, falling back to its linked Item Master catalog row's hsn_code (via item_id) when set —
  // same "own field first, catalog as fallback" precedent as item_code elsewhere in this app. A
  // packing_items row with no bom_item_id at all (a hand-typed line never tied back to a BOM item)
  // has nowhere for a code to come from and is treated the same as "missing."
  const lineItems = await queryAll(
    `SELECT pi.id, pi.material_description, pi.bom_item_id, COALESCE(b.hsn_code, i.hsn_code) AS hsn_code
       FROM packing_items pi
       LEFT JOIN bom_items b ON b.id = pi.bom_item_id
       LEFT JOIN items i ON i.id = b.item_id
      WHERE pi.packing_list_id = ?`,
    [params.id]
  );
  const missingHsn = lineItems.filter(li => !li.hsn_code);
  if (missingHsn.length) {
    return NextResponse.json({
      error: `${missingHsn.length} item(s) are missing an HSN code — add HSN codes on the BOM before generating: ${missingHsn.map(li => li.material_description).join(', ')}`,
    }, { status: 400 });
  }

  const credentials = await loadCredentials(list.company);

  try {
    const result = await generateEwayBill({ company: list.company, credentials, payload: { packingListId: list.id, packingNo: list.packing_no } });
    await execute('UPDATE packing_lists SET eway_bill_no = ?, eway_bill_date = ? WHERE id = ?', [result.ewayBillNo, result.date, params.id]);
    return NextResponse.json({ ok: true, ewayBillNo: result.ewayBillNo, date: result.date });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
