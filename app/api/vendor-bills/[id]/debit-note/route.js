// app/api/vendor-bills/[id]/debit-note/route.js — mirrors
// app/api/sales-invoices/[id]/credit-note (Phase 2), purchase direction.
import { NextResponse } from 'next/server';
import { execute, queryOne, nextCounterValue } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { audit } from '@/lib/usb';
import { financialYear } from '@/lib/gst-calc.mjs';
import { todayISO } from '@/lib/date';
import { postJournalEntry } from '@/lib/ledger-post';
import { purchaseDebitNoteLines } from '@/lib/ledger.mjs';

export async function POST(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Procurement');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Procurement', 'procurement.debit_note.write');
  if (actionDenied) return actionDenied;

  const bill = await queryOne('SELECT * FROM vendor_bills WHERE id = ?', [params.id]);
  if (!bill) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const b = await req.json();
  const items = Array.isArray(b.items) ? b.items.filter(it => it.item_description && it.amount) : [];
  if (!items.length) return NextResponse.json({ error: 'At least one line item is required' }, { status: 400 });
  const amount = items.reduce((sum, it) => sum + Number(it.amount || 0), 0);

  const debitNoteDate = b.debit_note_date || todayISO();
  const fy = financialYear(debitNoteDate);
  const seq = await nextCounterValue(`debit_note_no:${bill.company}:${fy}`, 0);
  // debit_note_no is globally UNIQUE, but the counter is per-company — same fix as the credit-note
  // route: the company's own invoice_prefix has to be part of the number, or two companies' first
  // debit note of the year both come out "DN/1/2026-27" and the second INSERT throws a UNIQUE
  // violation.
  const companyRow = await queryOne('SELECT invoice_prefix FROM company_settings WHERE company = ?', [bill.company]);
  const debitNoteNo = `${companyRow?.invoice_prefix || bill.company}/DN/${seq}/${fy}`;

  const { lastId } = await execute(
    `INSERT INTO purchase_debit_notes (debit_note_no, vendor_bill_id, company, debit_note_date, reason, amount, status, created_by)
     VALUES (?, ?, ?, ?, ?, ?, 'issued', ?)`,
    [debitNoteNo, bill.id, bill.company, debitNoteDate, b.reason ?? null, amount, user.username]
  );
  const debitNoteId = Number(lastId);
  let sortOrder = 0;
  for (const it of items) {
    await execute(
      `INSERT INTO purchase_debit_note_items (purchase_debit_note_id, item_description, qty, rate, amount, sort_order) VALUES (?, ?, ?, ?, ?, ?)`,
      [debitNoteId, it.item_description, it.qty ?? null, it.rate ?? null, it.amount, sortOrder++]
    );
  }
  await audit('purchase_debit_note_created', { actor: user.username, detail: `${debitNoteNo} against ${bill.bill_no}` });

  // ACCOUNTING-IMPLEMENTATION-PLAN.md Phase 5 — same "posts at creation, not from a status route"
  // reasoning as the Sales Credit Note route (a debit note is also created 'issued' directly).
  await postJournalEntry({
    company: bill.company,
    entryDate: debitNoteDate,
    sourceType: 'purchase_debit_note',
    sourceId: debitNoteId,
    description: `Debit Note ${debitNoteNo} against ${bill.bill_no}`,
    lines: purchaseDebitNoteLines({ amount }),
    createdBy: user.username,
  });
  return NextResponse.json({ id: debitNoteId, debit_note_no: debitNoteNo });
}
