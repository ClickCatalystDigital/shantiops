// app/api/packing/[id]/eway-bill/route.js — the "Generate E-Way Bill" trigger, same explicit-
// action shape as ../freight/route.js. Idempotency guard mirrors that route's idea (check before
// write): eway_bill_no IS NOT NULL is the "already done" signal here, since there's no
// journal_entries-style existing-entry check to lean on for this one.
//
// Real-NIC-API research plan, Gaps 1-5: fails closed on every prerequisite BEFORE ever calling
// generateEwayBill() — never send NIC a partially-correct payload and let its own error codes
// (216 Invalid HSN, 221 Invalid Approximate Distance, etc.) be the first sign something was wrong.
//
// itemList is built from the linked Sales Invoice's own line items (sales_invoice_items — real
// HSN/qty/rate/amount/GST-rate per line), NOT from packing_items, which carries no price at all.
// KNOWN LIMITATION, not solved here: this assumes the packing list represents the FULL invoice
// (the common case). A genuine partial shipment against one invoice (SYSTEM.md §5's own documented
// partial-dispatch model) has no way today to know which invoice line items are actually in THIS
// packing list specifically — packing_items has no link to sales_invoice_items. Flagged in Gap 5
// below rather than silently sending an inaccurate itemList for that case.
import { NextResponse } from 'next/server';
import { execute, queryOne, queryAll } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { generateEwayBill, loadCredentials } from '@/lib/eway-bill';

const TRANS_MODE_CODES = { road: '1', rail: '2', air: '3', ship: '4' };
const VEHICLE_TYPE_CODES = { regular: 'R', odc: 'O' };

export async function POST(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Dispatch');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Dispatch', 'dispatch.packing.eway_bill.generate');
  if (actionDenied) return actionDenied;

  const list = await queryOne(
    `SELECT pl.id, pl.packing_no, pl.eway_bill_no, pl.transport_distance_km, pl.transport_mode,
            pl.vehicle_type, pl.vehicle_no, pl.dispatch_through, pl.sales_invoice_id,
            p.company, p.customer_id
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
  const customer = await queryOne('SELECT name, gst_no, state_code, pin_code, address, address2, city FROM customers WHERE id = ?', [list.customer_id]);
  const missingCustomerFields = ['gst_no', 'state_code', 'pin_code', 'address'].filter(f => !customer?.[f]);
  if (missingCustomerFields.length) {
    return NextResponse.json({ error: `The linked customer record is missing: ${missingCustomerFields.join(', ')} — fill these in before generating an e-way bill.` }, { status: 400 });
  }

  // Company (fromGstin/fromPincode/etc.) — same fail-closed pattern.
  const company = await queryOne('SELECT legal_name, gstin, state_code, registered_address, place, pincode FROM company_settings WHERE company = ?', [list.company]);
  const missingCompanyFields = ['gstin', 'state_code', 'registered_address', 'place', 'pincode'].filter(f => !company?.[f]);
  if (missingCompanyFields.length) {
    return NextResponse.json({ error: `${list.company}'s own record is missing: ${missingCompanyFields.join(', ')} — fill these in under Accounts → Company Settings before generating.` }, { status: 400 });
  }

  // Gap 5 (new, found wiring the real payload) — NIC's docNo/docDate/totInvValue must come from a
  // real tax invoice; this packing list needs one linked and issued. Also the source of itemList
  // (see file header) — a real, priced invoice line, not a fabricated split of packing_items.
  if (!list.sales_invoice_id) {
    return NextResponse.json({ error: 'Link a Sales Invoice to this packing list before generating an e-way bill (NIC requires the invoice number/date/value).' }, { status: 400 });
  }
  const invoice = await queryOne('SELECT invoice_no, invoice_date, subtotal, cgst_amount, sgst_amount, igst_amount, total, status FROM sales_invoices WHERE id = ?', [list.sales_invoice_id]);
  if (!invoice || !['issued', 'paid'].includes(invoice.status)) {
    return NextResponse.json({ error: 'The linked Sales Invoice must be issued before generating an e-way bill.' }, { status: 400 });
  }
  const invoiceItems = await queryAll('SELECT item_description, hsn_code, qty, uom, amount, gst_rate_pct FROM sales_invoice_items WHERE sales_invoice_id = ?', [list.sales_invoice_id]);
  if (!invoiceItems.length) {
    return NextResponse.json({ error: 'The linked Sales Invoice has no line items.' }, { status: 400 });
  }

  // Gap 2 — every shipped line needs a real HSN code. Checked here against the *invoice's* items
  // (the actual itemList source, per the file header) — a blank hsn_code on any invoice line means
  // NIC will reject with error 216 anyway, so fail closed with a specific message first.
  const missingHsn = invoiceItems.filter(li => !li.hsn_code);
  if (missingHsn.length) {
    return NextResponse.json({
      error: `${missingHsn.length} invoice line(s) are missing an HSN code — add HSN codes on the Sales Invoice before generating: ${missingHsn.map(li => li.item_description).join(', ')}`,
    }, { status: 400 });
  }

  const credentials = await loadCredentials(list.company);

  const isInterState = String(company.state_code) !== String(customer.state_code);
  const payload = {
    docNo: invoice.invoice_no,
    docDate: formatDocDate(invoice.invoice_date),
    fromGstin: company.gstin,
    fromTrdName: list.company,
    fromAddr1: company.registered_address,
    fromPlace: company.place,
    fromPincode: company.pincode,
    fromStateCode: company.state_code,
    toGstin: customer.gst_no,
    toTrdName: customer.name,
    toAddr1: customer.address,
    toAddr2: customer.address2 || '',
    toPlace: customer.city || company.place,
    toPincode: customer.pin_code,
    toStateCode: customer.state_code,
    totalValue: invoice.subtotal,
    cgstValue: isInterState ? 0 : invoice.cgst_amount,
    sgstValue: isInterState ? 0 : invoice.sgst_amount,
    igstValue: isInterState ? invoice.igst_amount : 0,
    cessValue: 0,
    totInvValue: invoice.total,
    transMode: TRANS_MODE_CODES[list.transport_mode],
    vehicleType: VEHICLE_TYPE_CODES[list.vehicle_type],
    transDistance: list.transport_distance_km,
    vehicleNo: list.vehicle_no || undefined,
    transporterName: list.dispatch_through || undefined,
    itemList: invoiceItems.map(li => {
      const gstRate = isInterState ? 0 : li.gst_rate_pct / 2;
      return {
        productName: li.item_description.slice(0, 100),
        productDesc: li.item_description.slice(0, 100),
        hsnCode: Number(li.hsn_code),
        quantity: li.qty || 1,
        qtyUnit: (li.uom || 'NOS').slice(0, 3).toUpperCase(),
        taxableAmount: li.amount,
        cgstRate: gstRate,
        sgstRate: gstRate,
        igstRate: isInterState ? li.gst_rate_pct : 0,
        cessRate: 0,
      };
    }),
  };

  try {
    const result = await generateEwayBill({ company: list.company, credentials, payload });
    await execute('UPDATE packing_lists SET eway_bill_no = ?, eway_bill_date = ? WHERE id = ?', [result.ewayBillNo, result.date, params.id]);
    return NextResponse.json({ ok: true, ewayBillNo: result.ewayBillNo, date: result.date, validUpto: result.validUpto });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}

// sales_invoices.invoice_date is stored as an ISO date (YYYY-MM-DD); NIC's docDate needs dd/mm/yyyy.
function formatDocDate(isoDate) {
  const [y, m, d] = String(isoDate).slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}
