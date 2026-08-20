// app/api/sales-invoices/[id]/receipts/route.js — ACCOUNTING-IMPLEMENTATION-PLAN.md Phase 5
// completion (AR settlement). Same numbered-document shape as
// app/api/sales-invoices/[id]/credit-note (real per-company per-FY series via `counters`).
// Recording a receipt posts Bank & Cash / Accounts Receivable directly — it does not touch the
// invoice's own Sales Invoice journal entry (Revenue/GST were already posted at issue).
import { NextResponse } from 'next/server';
import { execute, queryOne, queryAll, nextCounterValue } from '@/lib/db';
import { getFreshSessionUser, canAccessDepartment, isPM } from '@/lib/auth';
import { requireCrmAction } from '@/lib/action-permissions';
import { audit } from '@/lib/usb';
import { financialYear } from '@/lib/gst-calc.mjs';
import { customerReceiptLines } from '@/lib/ledger.mjs';
import { postJournalEntry } from '@/lib/ledger-post';
import { todayISO } from '@/lib/date';

const CRM_DEPARTMENTS = ['Sales', 'Marketing'];
function canAccessCrm(user) {
  return isPM(user) || CRM_DEPARTMENTS.some(d => canAccessDepartment(user, d));
}
function canView(user) {
  return canAccessCrm(user) || canAccessDepartment(user, 'Accounts');
}

export async function GET(req, { params }) {
  const user = await getFreshSessionUser();
  if (!canView(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  return NextResponse.json(await queryAll('SELECT * FROM customer_receipts WHERE sales_invoice_id = ? ORDER BY receipt_date, id', [params.id]));
}

export async function POST(req, { params }) {
  const user = await getFreshSessionUser();
  if (!canAccessCrm(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const actionDenied = await requireCrmAction(user, 'sales.invoice.receipt.write');
  if (actionDenied) return actionDenied;

  const invoice = await queryOne('SELECT * FROM sales_invoices WHERE id = ?', [params.id]);
  if (!invoice) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!['issued', 'paid'].includes(invoice.status)) {
    return NextResponse.json({ error: 'Only an issued invoice can receive a payment' }, { status: 409 });
  }

  const b = await req.json();
  const amount = Number(b.amount);
  if (!(amount > 0)) return NextResponse.json({ error: 'Enter a positive amount' }, { status: 400 });

  const alreadyReceived = await queryOne('SELECT COALESCE(SUM(amount), 0) AS n FROM customer_receipts WHERE sales_invoice_id = ?', [invoice.id]);
  const balanceDue = Math.round((invoice.total - alreadyReceived.n) * 100) / 100;
  if (amount > balanceDue + 0.01) {
    return NextResponse.json({ error: `Amount exceeds the balance due (₹${balanceDue})` }, { status: 400 });
  }

  const receiptDate = b.receipt_date || todayISO();
  const fy = financialYear(receiptDate);
  const seq = await nextCounterValue(`receipt_no:${invoice.company}:${fy}`, 0);
  const companyRow = await queryOne('SELECT invoice_prefix FROM company_settings WHERE company = ?', [invoice.company]);
  const receiptNo = `${companyRow?.invoice_prefix || invoice.company}/RCT/${seq}/${fy}`;

  const { lastId } = await execute(
    `INSERT INTO customer_receipts (receipt_no, sales_invoice_id, company, receipt_date, amount, payment_mode, reference, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [receiptNo, invoice.id, invoice.company, receiptDate, amount, b.payment_mode ?? null, b.reference ?? null, user.username]
  );
  const receiptId = Number(lastId);

  await postJournalEntry({
    company: invoice.company,
    entryDate: receiptDate,
    sourceType: 'customer_receipt',
    sourceId: receiptId,
    description: `Receipt ${receiptNo} against ${invoice.invoice_no}`,
    lines: customerReceiptLines({ amount }),
    createdBy: user.username,
  });

  const nowBalance = Math.round((balanceDue - amount) * 100) / 100;
  if (nowBalance <= 0.01 && invoice.status !== 'paid') {
    await execute("UPDATE sales_invoices SET status = 'paid', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [invoice.id]);
  }

  await audit('customer_receipt_recorded', { actor: user.username, detail: `${receiptNo} against ${invoice.invoice_no}: ${amount}` });
  return NextResponse.json({ id: receiptId, receipt_no: receiptNo, balance_due: Math.max(nowBalance, 0) });
}
