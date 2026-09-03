// app/api/sales-invoices/[id]/route.js — status/payment_ref updates. Same shape as
// app/api/quotations/[id]/route.js's PATCH.
import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, canAccessDepartment, isPM } from '@/lib/auth';
import { requireCrmAction, requireAction } from '@/lib/action-permissions';
import { getSalesInvoiceDetail } from '@/lib/data';
import { audit } from '@/lib/usb';
import { notifyProjectCustomers } from '@/lib/notify';
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

// Accounts' own path — payment reconciliation only. Confirmed ownership split: Sales/Marketing
// keep sole authority over the commercial/issuance fields (draft/issued/cancelled, due_date,
// notes); Accounts may only mark an invoice paid and record the payment reference. A PM (who also
// passes canAccessCrm) always takes the full path below, never this narrower one.
const ACCOUNTS_PAYMENT_FIELDS = ['status', 'payment_ref'];

export async function PATCH(req, { params }) {
  const user = await getFreshSessionUser();
  const b = await req.json();
  const isCrm = canAccessCrm(user);
  const isAccountsPaymentOnly = !isCrm && canAccessDepartment(user, 'Accounts');

  if (!isCrm && !isAccountsPaymentOnly) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  if (isAccountsPaymentOnly) {
    const submittedKeys = Object.keys(b);
    if (!submittedKeys.every(k => ACCOUNTS_PAYMENT_FIELDS.includes(k)) || (b.status !== undefined && b.status !== 'paid')) {
      return NextResponse.json({ error: 'Accounts can only mark an invoice paid and record the payment reference' }, { status: 403 });
    }
    const actionDenied = await requireAction(user, 'Accounts', 'accounts.invoice.mark_paid');
    if (actionDenied) return actionDenied;
  } else {
    const actionDenied = await requireCrmAction(user, 'sales.invoice.status');
    if (actionDenied) return actionDenied;
  }

  if (b.status !== undefined && !STATUSES.includes(b.status)) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
  }
  const invoice = await queryOne('SELECT * FROM sales_invoices WHERE id = ?', [params.id]);
  if (!invoice) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const fields = [];
  const args = [];
  const allowedKeys = isAccountsPaymentOnly ? ACCOUNTS_PAYMENT_FIELDS : ['status', 'due_date', 'payment_ref', 'notes'];
  for (const key of allowedKeys) {
    if (b[key] !== undefined) { fields.push(`${key} = ?`); args.push(b[key]); }
  }
  if (!fields.length) return NextResponse.json({ error: 'No fields to update' }, { status: 400 });

  // ACCOUNTING-IMPLEMENTATION-PLAN.md Phase 5 — auto-post on issue (2026-08-20 decision). Also
  // fires on a direct draft->paid jump so an invoice can't skip the ledger just because "issued"
  // was never set explicitly; postJournalEntry() is idempotent per source document either way.
  //
  // Runs BEFORE the status UPDATE below (mirrors the same fix in vendor-bills/[id]/route.js, found
  // via a real RCM test transaction): if postJournalEntry() throws, nothing should be written yet,
  // so the invoice stays in its prior status and a retry can post cleanly — not left permanently
  // marked issued/paid with no corresponding ledger entry.
  if (['issued', 'paid'].includes(b.status)) {
    await postJournalEntry({
      company: invoice.company,
      entryDate: invoice.invoice_date,
      sourceType: 'sales_invoice',
      sourceId: invoice.id,
      description: `Sales Invoice ${invoice.invoice_no}`,
      lines: salesInvoiceLines({ subtotal: invoice.subtotal, taxAmount: invoice.tax_amount, total: invoice.total, isReverseCharge: !!invoice.is_reverse_charge }),
      createdBy: user.username,
    });
  }

  fields.push('updated_at = CURRENT_TIMESTAMP');
  args.push(params.id);
  await execute(`UPDATE sales_invoices SET ${fields.join(', ')} WHERE id = ?`, args);
  await audit('sales_invoice_updated', { actor: user.username, detail: `#${params.id}${b.status ? `: ${b.status}` : ''}` });

  // Real draft->issued/paid flip only — the moment this invoice first becomes a real document a
  // customer can see in their portal (§6). No project_id (an invoice not tied to a project) has no
  // one to notify.
  if (invoice.status === 'draft' && ['issued', 'paid'].includes(b.status) && invoice.project_id) {
    await notifyProjectCustomers(invoice.project_id, {
      kind: 'invoice_issued',
      title: 'A new invoice is available',
      body: `Invoice ${invoice.invoice_no} — ₹${invoice.total.toLocaleString('en-IN')}`,
      dedupe_key: `invoice_issued:${invoice.id}`,
    });
  }
  return NextResponse.json({ ok: true });
}
