// app/api/sales-invoices/[id]/credit-note/route.js — ACCOUNTING-IMPLEMENTATION-PLAN.md Phase 2.
// Replaces sales_returns.credit_note_ref's free text with a real linked document; sales_returns
// itself is untouched — this is the document a return can now point at by number.
import { NextResponse } from 'next/server';
import { execute, queryOne, nextCounterValue } from '@/lib/db';
import { getFreshSessionUser, canAccessDepartment, isPM } from '@/lib/auth';
import { requireCrmAction } from '@/lib/action-permissions';
import { audit } from '@/lib/usb';
import { financialYear } from '@/lib/gst-calc.mjs';
import { todayISO } from '@/lib/date';
import { postJournalEntry } from '@/lib/ledger-post';
import { salesCreditNoteLines } from '@/lib/ledger.mjs';

const CRM_DEPARTMENTS = ['Sales', 'Marketing'];
function canAccessCrm(user) {
  return isPM(user) || CRM_DEPARTMENTS.some(d => canAccessDepartment(user, d));
}

export async function POST(req, { params }) {
  const user = await getFreshSessionUser();
  if (!canAccessCrm(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const actionDenied = await requireCrmAction(user, 'sales.credit_note.write');
  if (actionDenied) return actionDenied;

  const invoice = await queryOne('SELECT * FROM sales_invoices WHERE id = ?', [params.id]);
  if (!invoice) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const b = await req.json();
  const items = Array.isArray(b.items) ? b.items.filter(it => it.item_description && it.amount) : [];
  if (!items.length) return NextResponse.json({ error: 'At least one line item is required' }, { status: 400 });
  const amount = items.reduce((sum, it) => sum + Number(it.amount || 0), 0);

  const creditNoteDate = b.credit_note_date || todayISO();
  const fy = financialYear(creditNoteDate);
  const seq = await nextCounterValue(`credit_note_no:${invoice.company}:${fy}`, 0);
  // credit_note_no is globally UNIQUE, but the counter is per-company — the company's own
  // invoice_prefix has to be part of the number itself, or two companies' first credit note of
  // the year both come out "CN/1/2026-27" and the second INSERT throws a UNIQUE violation.
  const companyRow = await queryOne('SELECT invoice_prefix FROM company_settings WHERE company = ?', [invoice.company]);
  const creditNoteNo = `${companyRow?.invoice_prefix || invoice.company}/CN/${seq}/${fy}`;

  const { lastId } = await execute(
    `INSERT INTO sales_credit_notes (credit_note_no, sales_invoice_id, company, credit_note_date, reason, amount, status, created_by)
     VALUES (?, ?, ?, ?, ?, ?, 'issued', ?)`,
    [creditNoteNo, invoice.id, invoice.company, creditNoteDate, b.reason ?? null, amount, user.username]
  );
  const creditNoteId = Number(lastId);
  let sortOrder = 0;
  for (const it of items) {
    await execute(
      `INSERT INTO sales_credit_note_items (sales_credit_note_id, item_description, qty, rate, amount, sort_order) VALUES (?, ?, ?, ?, ?, ?)`,
      [creditNoteId, it.item_description, it.qty ?? null, it.rate ?? null, it.amount, sortOrder++]
    );
  }
  await audit('sales_credit_note_created', { actor: user.username, detail: `${creditNoteNo} against ${invoice.invoice_no}` });

  // ACCOUNTING-IMPLEMENTATION-PLAN.md Phase 5 — a credit note is created 'issued' directly (no
  // draft stage, unlike the invoice it reverses), so it posts here at creation, not from a status
  // route.
  await postJournalEntry({
    company: invoice.company,
    entryDate: creditNoteDate,
    sourceType: 'sales_credit_note',
    sourceId: creditNoteId,
    description: `Credit Note ${creditNoteNo} against ${invoice.invoice_no}`,
    lines: salesCreditNoteLines({ amount }),
    createdBy: user.username,
  });
  return NextResponse.json({ id: creditNoteId, credit_note_no: creditNoteNo });
}
