// app/api/stock-receipts/route.js — Phase 2 receipt-event header (design Part 17.2/20/22.2).
// Stores creates one receipt per physical delivery (one supplier, optionally one PO), then receives
// one or more pieces/batches/serials against it via their own POST routes' receipt_id.
import { NextResponse } from 'next/server';
import { getFreshSessionUser, requireDepartment, isInternal } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { createReceipt, listRecentReceipts } from '@/lib/stock-receipts';
import { audit } from '@/lib/usb';

// GET — recent receipts for ReceiptPicker.jsx's "pick an existing one" list.
export async function GET() {
  const user = await getFreshSessionUser();
  if (!isInternal(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  return NextResponse.json(await listRecentReceipts());
}

export async function POST(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Stores');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Stores', 'stores.inventory.write');
  if (actionDenied) return actionDenied;

  const b = await req.json();
  try {
    const result = await createReceipt({
      supplierId: b.supplier_id ? Number(b.supplier_id) : undefined,
      poId: b.po_id ? Number(b.po_id) : undefined,
      grnRef: b.grn_ref,
      invoiceNo: b.invoice_no,
      gateInwardReceiptId: b.gate_inward_receipt_id ? Number(b.gate_inward_receipt_id) : undefined,
      username: user.username,
    });
    await audit('stock_receipt_created', { actor: user.username, detail: result.inward_batch_no });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
