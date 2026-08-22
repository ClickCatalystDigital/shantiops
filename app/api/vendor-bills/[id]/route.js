// app/api/vendor-bills/[id]/route.js — status/payment_ref updates. Same shape as
// app/api/sales-invoices/[id]/route.js.
import { NextResponse } from 'next/server';
import { execute, queryOne, queryAll } from '@/lib/db';
import { getFreshSessionUser, requireDepartment, isPM, canAccessDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { getVendorBillDetail } from '@/lib/data';
import { audit } from '@/lib/usb';
import { postJournalEntry } from '@/lib/ledger-post';
import { vendorBillLines } from '@/lib/ledger.mjs';
import { weightedAverageCost } from '@/lib/inventory-costing.mjs';

const STATUSES = ['draft', 'approved', 'paid', 'cancelled'];

export async function GET(req, { params }) {
  const user = await getFreshSessionUser();
  if (!isPM(user) && !canAccessDepartment(user, 'Procurement') && !canAccessDepartment(user, 'Accounts')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const detail = await getVendorBillDetail(params.id);
  if (!detail) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(detail);
}

export async function PATCH(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Procurement');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Procurement', 'procurement.vendor_bill.status');
  if (actionDenied) return actionDenied;
  const b = await req.json();
  if (b.status !== undefined && !STATUSES.includes(b.status)) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
  }
  const bill = await queryOne('SELECT * FROM vendor_bills WHERE id = ?', [params.id]);
  if (!bill) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const fields = [];
  const args = [];
  for (const key of ['status', 'due_date', 'payment_ref', 'notes']) {
    if (b[key] !== undefined) { fields.push(`${key} = ?`); args.push(b[key]); }
  }
  if (!fields.length) return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  fields.push('updated_at = CURRENT_TIMESTAMP');
  args.push(params.id);
  await execute(`UPDATE vendor_bills SET ${fields.join(', ')} WHERE id = ?`, args);
  await audit('vendor_bill_updated', { actor: user.username, detail: `#${params.id}${b.status ? `: ${b.status}` : ''}` });

  // ACCOUNTING-IMPLEMENTATION-PLAN.md Phase 5 — 'approved' is a Vendor Bill's "issued" equivalent
  // (the point AP is actually recognized); also fires on a direct draft->paid jump, same reasoning
  // as the Sales Invoice route. postJournalEntry() is idempotent per source document. Guarded on
  // the bill's PREVIOUS status (fetched above, before this PATCH's UPDATE ran) so a bill that was
  // already approved/paid doesn't get its GL entry or inventory receipt reprocessed by a repeated
  // PATCH to the same status.
  const firstTimeSettled = !['approved', 'paid'].includes(bill.status) && ['approved', 'paid'].includes(b.status);
  if (firstTimeSettled) {
    await postJournalEntry({
      company: bill.company,
      entryDate: bill.bill_date,
      sourceType: 'vendor_bill',
      sourceId: bill.id,
      description: `Vendor Bill ${bill.bill_no}`,
      lines: vendorBillLines({ subtotal: bill.subtotal, taxAmount: bill.tax_amount, tdsAmount: bill.tds_amount, payableAmount: bill.payable_amount, isReverseCharge: !!bill.is_reverse_charge }),
      createdBy: user.username,
    });

    // Inventory consumption costing (Phase 5 completion) — receive stock at the bill's line rate
    // into whichever lines resolve to a real inventory_items row (bom_item -> catalog item ->
    // tracked inventory row; see lib/db.js's vendor_bill_items.bom_item_id comment). A line that
    // doesn't resolve just isn't costed, same as it wasn't before this pass.
    const billItems = await queryAll(
      `SELECT vbi.qty, vbi.rate, ii.id AS inventory_item_id, ii.on_hand, ii.avg_cost
         FROM vendor_bill_items vbi
         JOIN bom_items b ON b.id = vbi.bom_item_id
         JOIN inventory_items ii ON ii.item_id = b.item_id
        WHERE vbi.vendor_bill_id = ? AND vbi.bom_item_id IS NOT NULL`,
      [bill.id]
    );
    for (const it of billItems) {
      const newAvgCost = weightedAverageCost({
        existingQty: it.on_hand, existingAvgCost: it.avg_cost, receivedQty: it.qty, receivedUnitCost: it.rate,
      });
      await execute('UPDATE inventory_items SET on_hand = on_hand + ?, avg_cost = ? WHERE id = ?', [it.qty, newAvgCost, it.inventory_item_id]);
    }
  }
  return NextResponse.json({ ok: true });
}
