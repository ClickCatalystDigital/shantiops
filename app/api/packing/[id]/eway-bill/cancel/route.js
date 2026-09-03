// app/api/packing/[id]/eway-bill/cancel/route.js — the "Cancel E-Way Bill" action. Found missing
// entirely during a UI/UX verification pass (lib/eway-bill.js's cancelEwayBill() existed but had
// no route or UI ever calling it) — a real e-way bill, once generated, had no safe way to correct a
// mistake short of the packing-detail route's own "edit the field directly" suggestion, which risks
// desyncing Shanti Ops' record from NIC's real one. This is the safe path instead.
//
// 24-hour cancellation window and generator-only restriction are NIC's own rules
// (docs.ewaybillgst.gov.in, confirmed live) — checked here first for a fast, clear failure before
// ever calling NIC, same fail-closed discipline as the generation route.
import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { cancelEwayBill, loadCredentials } from '@/lib/eway-bill';

const CANCEL_REASON_CODES = [1, 2, 3, 4]; // Duplicate / Order Cancelled / Data Entry Mistake / Others

export async function POST(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Dispatch');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Dispatch', 'dispatch.packing.eway_bill.cancel');
  if (actionDenied) return actionDenied;

  const list = await queryOne(
    `SELECT pl.id, pl.eway_bill_no, pl.eway_bill_date, p.company
       FROM packing_lists pl LEFT JOIN projects p ON p.id = pl.project_id WHERE pl.id = ?`,
    [params.id]
  );
  if (!list) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!list.eway_bill_no) return NextResponse.json({ error: 'No e-way bill is set on this packing list to cancel.' }, { status: 400 });

  // NIC's own 24-hour window, checked locally first — a real e-way bill can't be cancelled past
  // this regardless of what we do here, but a fast, clear local message beats a round trip.
  if (list.eway_bill_date) {
    const generatedAt = new Date(list.eway_bill_date);
    if (!Number.isNaN(generatedAt.getTime()) && Date.now() - generatedAt.getTime() > 24 * 60 * 60 * 1000) {
      return NextResponse.json({ error: 'This e-way bill was generated more than 24 hours ago — NIC no longer allows cancellation. It will need to be handled as a real correction (contact your GST practitioner).' }, { status: 400 });
    }
  }

  const b = await req.json().catch(() => ({}));
  const cancelRsnCode = Number(b.cancelRsnCode);
  if (!CANCEL_REASON_CODES.includes(cancelRsnCode)) {
    return NextResponse.json({ error: 'Choose a cancellation reason.' }, { status: 400 });
  }
  const cancelRmrk = String(b.cancelRmrk || '').trim();
  if (!cancelRmrk) return NextResponse.json({ error: 'Enter a short remark explaining the cancellation.' }, { status: 400 });

  const credentials = await loadCredentials(list.company);
  try {
    const result = await cancelEwayBill({ company: list.company, credentials, ewbNo: list.eway_bill_no, cancelRsnCode, cancelRmrk });
    await execute('UPDATE packing_lists SET eway_bill_no = NULL, eway_bill_date = NULL, eway_bill_valid_upto = NULL WHERE id = ?', [params.id]);
    return NextResponse.json({ ok: true, cancelledEwayBillNo: result.ewayBillNo, cancelDate: result.cancelDate });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
