// app/api/reports/vendor-ledger/route.js — REPORT-ENGINE-PLAN.md §10. Mirror of
// customer-ledger/route.js: same runningLedger() rollup, against a supplier instead of a customer.
import { NextResponse } from 'next/server';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { getVendorLedgerLines } from '@/lib/data';
import { queryOne } from '@/lib/db';
import { runningLedger } from '@/lib/ledger.mjs';
import { COMPANY_NAMES } from '@/lib/qc-doc-pdf.js';

export async function computeVendorLedger(company, { supplierId, from, to } = {}) {
  if (!supplierId) throw new Error('supplier_id is required');
  const [supplier, rows] = await Promise.all([
    queryOne('SELECT id, name FROM suppliers WHERE id = ?', [supplierId]),
    getVendorLedgerLines(supplierId, company),
  ]);
  if (!supplier) throw new Error('Supplier not found');
  return { supplier, ...runningLedger(rows, { from, to }) };
}

export async function GET(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Accounts');
  if (denied) return denied;
  const { searchParams } = new URL(req.url);
  const company = COMPANY_NAMES.includes(searchParams.get('company')) ? searchParams.get('company') : COMPANY_NAMES[0];
  const supplierId = searchParams.get('supplier_id') || undefined;
  const from = searchParams.get('from') || undefined;
  const to = searchParams.get('to') || undefined;
  if (!supplierId) return NextResponse.json({ supplier: null, openingBalance: 0, closingBalance: 0, entries: [] });
  try {
    return NextResponse.json(await computeVendorLedger(company, { supplierId, from, to }));
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
