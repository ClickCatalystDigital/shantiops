// app/api/reports/customer-ledger/route.js — REPORT-ENGINE-PLAN.md §10 Phase 1. A running-balance
// statement of one customer's invoices/receipts/credit notes, same shape as trial-balance's route:
// computeCustomerLedger is exported so the PDF export (lib/reports/catalog.js) reuses the exact
// same result the screen/JSON route returns — ground rule 2.
import { NextResponse } from 'next/server';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { getCustomerLedgerLines } from '@/lib/data';
import { queryOne } from '@/lib/db';
import { runningLedger } from '@/lib/ledger.mjs';
import { COMPANY_NAMES } from '@/lib/qc-doc-pdf.js';

export async function computeCustomerLedger(company, { customerId, from, to } = {}) {
  if (!customerId) throw new Error('customer_id is required');
  const [customer, rows] = await Promise.all([
    queryOne('SELECT id, name FROM customers WHERE id = ?', [customerId]),
    getCustomerLedgerLines(customerId, company),
  ]);
  if (!customer) throw new Error('Customer not found');
  return { customer, ...runningLedger(rows, { from, to }) };
}

export async function GET(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Accounts');
  if (denied) return denied;
  const { searchParams } = new URL(req.url);
  const company = COMPANY_NAMES.includes(searchParams.get('company')) ? searchParams.get('company') : COMPANY_NAMES[0];
  const customerId = searchParams.get('customer_id') || undefined;
  const from = searchParams.get('from') || undefined;
  const to = searchParams.get('to') || undefined;
  if (!customerId) return NextResponse.json({ customer: null, openingBalance: 0, closingBalance: 0, entries: [] });
  try {
    const result = await computeCustomerLedger(company, { customerId, from, to });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
