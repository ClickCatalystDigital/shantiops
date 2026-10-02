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
import { execute } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { generateEwayBill, loadCredentials } from '@/lib/eway-bill';
import { loadEwayContext } from '@/lib/eway-context';
import { firstProblem } from '@/lib/eway-readiness.mjs';

const TRANS_MODE_CODES = { road: '1', rail: '2', air: '3', ship: '4' };
const VEHICLE_TYPE_CODES = { regular: 'R', odc: 'O' };

// Checklist for the Generate card: what is ready, what is missing and who fixes it. Read-only.
export async function GET(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Dispatch');
  if (denied) return denied;
  const ctx = await loadEwayContext(params.id);
  if (!ctx) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ checks: ctx.checks });
}

export async function POST(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Dispatch');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Dispatch', 'dispatch.packing.eway_bill.generate');
  if (actionDenied) return actionDenied;

  const ctx = await loadEwayContext(params.id);
  if (!ctx) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const { list, customer, company, invoice, invoiceItems } = ctx;
  if (list.eway_bill_no) {
    return NextResponse.json({ error: 'An e-way bill is already set on this packing list. Cancel it first (within 24 hours of generation) if this needs correcting.' }, { status: 409 });
  }
  // Fails closed on every prerequisite BEFORE calling NIC (see header) — same checklist the card shows.
  const problem = firstProblem(ctx.checks);
  if (problem) return NextResponse.json({ error: `${problem.label}: ${problem.fix}` }, { status: 400 });

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
    const isoDate = parseNicDateTime(result.date);
    const isoValidUpto = parseNicDateTime(result.validUpto);
    await execute(
      'UPDATE packing_lists SET eway_bill_no = ?, eway_bill_date = ?, eway_bill_valid_upto = ? WHERE id = ?',
      [result.ewayBillNo, isoDate, isoValidUpto, params.id]
    );
    return NextResponse.json({ ok: true, ewayBillNo: result.ewayBillNo, date: isoDate, validUpto: isoValidUpto });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}

// sales_invoices.invoice_date is stored as an ISO date (YYYY-MM-DD); NIC's docDate needs dd/mm/yyyy.
function formatDocDate(isoDate) {
  const [y, m, d] = String(isoDate).slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

// NIC returns dates as "dd/mm/yyyy hh:mm:ss AM/PM" (e.g. "16/09/2026 10:30:00 AM") — new Date(...)
// parses that as garbage (most JS engines assume US mm/dd/yyyy). Real bug found while building the
// Cancel action's 24-hour-window check, which needs a real, parseable timestamp. Converts to a
// proper ISO string once, at the point of storage, so every downstream reader (display, the cancel
// route's own date math) gets a value new Date() actually understands.
function parseNicDateTime(nicDateTime) {
  if (!nicDateTime) return null;
  const m = String(nicDateTime).match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) return null;
  let [, dd, mm, yyyy, hh, min, ss, ampm] = m;
  hh = Number(hh) % 12;
  if (ampm.toUpperCase() === 'PM') hh += 12;
  return `${yyyy}-${mm}-${dd}T${String(hh).padStart(2, '0')}:${min}:${ss}`;
}
