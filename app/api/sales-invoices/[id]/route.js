// app/api/sales-invoices/[id]/route.js — status/payment_ref updates. Same shape as
// app/api/quotations/[id]/route.js's PATCH.
import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, canAccessDepartment, isPM } from '@/lib/auth';
import { requireCrmAction } from '@/lib/action-permissions';
import { getSalesInvoiceDetail } from '@/lib/data';
import { audit } from '@/lib/usb';
import { postJournalEntry } from '@/lib/ledger-post';
import { salesInvoiceLines } from '@/lib/ledger.mjs';

const CRM_DEPARTMENTS = ['Sales', 'Marketing'];
const STATUSES = ['draft', 'issued', 'paid', 'cancelled'];
function canAccessCrm(user) {
  return isPM(user) || CRM_DEPARTMENTS.some(d => canAccessDepartment(user, d));
}
function canView(user) {
  return canAccessCrm(user) || canAccessDepartment(user, 'Accounts');
}

export async function GET(req, { params }) {
  const user = await getFreshSessionUser();
  if (!canView(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const detail = await getSalesInvoiceDetail(params.id);
  if (!detail) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(detail);
}

export async function PATCH(req, { params }) {
  const user = await getFreshSessionUser();
  if (!canAccessCrm(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const actionDenied = await requireCrmAction(user, 'sales.invoice.status');
  if (actionDenied) return actionDenied;
  const b = await req.json();
  if (b.status !== undefined && !STATUSES.includes(b.status)) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
  }
  const invoice = await queryOne('SELECT * FROM sales_invoices WHERE id = ?', [params.id]);
  if (!invoice) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const fields = [];
  const args = [];
  for (const key of ['status', 'due_date', 'payment_ref', 'notes']) {
    if (b[key] !== undefined) { fields.push(`${key} = ?`); args.push(b[key]); }
  }
  if (!fields.length) return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  fields.push('updated_at = CURRENT_TIMESTAMP');
  args.push(params.id);
  await execute(`UPDATE sales_invoices SET ${fields.join(', ')} WHERE id = ?`, args);
  await audit('sales_invoice_updated', { actor: user.username, detail: `#${params.id}${b.status ? `: ${b.status}` : ''}` });

  // ACCOUNTING-IMPLEMENTATION-PLAN.md Phase 5 — auto-post on issue (2026-08-20 decision). Also
  // fires on a direct draft->paid jump so an invoice can't skip the ledger just because "issued"
  // was never set explicitly; postJournalEntry() is idempotent per source document either way.
  if (['issued', 'paid'].includes(b.status)) {
    await postJournalEntry({
      company: invoice.company,
      entryDate: invoice.invoice_date,
      sourceType: 'sales_invoice',
      sourceId: invoice.id,
      description: `Sales Invoice ${invoice.invoice_no}`,
      lines: salesInvoiceLines({ subtotal: invoice.subtotal, taxAmount: invoice.tax_amount, total: invoice.total }),
      createdBy: user.username,
    });
  }
  return NextResponse.json({ ok: true });
}
