// app/api/vendor-bills/[id]/payments/route.js — ACCOUNTING-IMPLEMENTATION-PLAN.md Phase 5
// completion (AP settlement). Mirrors app/api/sales-invoices/[id]/receipts, purchase direction.
import { NextResponse } from 'next/server';
import { execute, queryOne, queryAll, nextCounterValue } from '@/lib/db';
import { getFreshSessionUser, requireDepartment, isPM, canAccessDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { audit } from '@/lib/usb';
import { financialYear } from '@/lib/gst-calc.mjs';
import { vendorPaymentLines } from '@/lib/ledger.mjs';
import { postJournalEntry } from '@/lib/ledger-post';
import { todayISO } from '@/lib/date';

function canView(user) {
  return isPM(user) || canAccessDepartment(user, 'Procurement') || canAccessDepartment(user, 'Accounts');
}

export async function GET(req, { params }) {
  const user = await getFreshSessionUser();
  if (!canView(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  return NextResponse.json(await queryAll('SELECT * FROM vendor_payments WHERE vendor_bill_id = ? ORDER BY payment_date, id', [params.id]));
}

export async function POST(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Procurement');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Procurement', 'procurement.vendor_bill.payment.write');
  if (actionDenied) return actionDenied;

  const bill = await queryOne('SELECT * FROM vendor_bills WHERE id = ?', [params.id]);
  if (!bill) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!['approved', 'paid'].includes(bill.status)) {
    return NextResponse.json({ error: 'Only an approved bill can be paid' }, { status: 409 });
  }

  const b = await req.json();
  const amount = Number(b.amount);
  if (!(amount > 0)) return NextResponse.json({ error: 'Enter a positive amount' }, { status: 400 });

  const alreadyPaid = await queryOne('SELECT COALESCE(SUM(amount), 0) AS n FROM vendor_payments WHERE vendor_bill_id = ?', [bill.id]);
  const balanceDue = Math.round((bill.payable_amount - alreadyPaid.n) * 100) / 100;
  if (amount > balanceDue + 0.01) {
    return NextResponse.json({ error: `Amount exceeds the balance due (₹${balanceDue})` }, { status: 400 });
  }

  const paymentDate = b.payment_date || todayISO();
  const fy = financialYear(paymentDate);
  const seq = await nextCounterValue(`payment_no:${bill.company}:${fy}`, 0);
  const companyRow = await queryOne('SELECT invoice_prefix FROM company_settings WHERE company = ?', [bill.company]);
  const paymentNo = `${companyRow?.invoice_prefix || bill.company}/PAY/${seq}/${fy}`;

  const { lastId } = await execute(
    `INSERT INTO vendor_payments (payment_no, vendor_bill_id, company, payment_date, amount, payment_mode, reference, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [paymentNo, bill.id, bill.company, paymentDate, amount, b.payment_mode ?? null, b.reference ?? null, user.username]
  );
  const paymentId = Number(lastId);

  await postJournalEntry({
    company: bill.company,
    entryDate: paymentDate,
    sourceType: 'vendor_payment',
    sourceId: paymentId,
    description: `Payment ${paymentNo} against ${bill.bill_no}`,
    lines: vendorPaymentLines({ amount }),
    createdBy: user.username,
  });

  const nowBalance = Math.round((balanceDue - amount) * 100) / 100;
  if (nowBalance <= 0.01 && bill.status !== 'paid') {
    await execute("UPDATE vendor_bills SET status = 'paid', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [bill.id]);
  }

  await audit('vendor_payment_recorded', { actor: user.username, detail: `${paymentNo} against ${bill.bill_no}: ${amount}` });
  return NextResponse.json({ id: paymentId, payment_no: paymentNo, balance_due: Math.max(nowBalance, 0) });
}
