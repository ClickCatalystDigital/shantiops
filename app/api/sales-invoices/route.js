// app/api/sales-invoices/route.js — list only; creation is exclusively via
// app/api/quotations/[id]/convert-to-invoice (ACCOUNTING-IMPLEMENTATION-PLAN.md Phase 2 — "Convert
// to Invoice from an accepted Quotation, not a from-scratch form as the only path in").
import { NextResponse } from 'next/server';
import { getFreshSessionUser, canAccessDepartment, isPM } from '@/lib/auth';
import { getSalesInvoices } from '@/lib/data';
import { scopeRows } from '@/lib/sales-visibility';
import { getSelectedCompanyFor } from '@/lib/company-filter-server';
import { filterByCompany } from '@/lib/company-filter.mjs';

const CRM_DEPARTMENTS = ['Sales', 'Marketing'];
function canAccessCrm(user) {
  return isPM(user) || CRM_DEPARTMENTS.some(d => canAccessDepartment(user, d));
}

export async function GET(req) {
  const user = await getFreshSessionUser();
  // Dispatch reads this too now — the packing-list sales_invoice_id picker (Dispatch accounting
  // integration, 2026-08-23) needs to list a project's invoices to link a shipment against.
  if (!canAccessCrm(user) && !canAccessDepartment(user, 'Accounts') && !canAccessDepartment(user, 'Dispatch')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const projectId = new URL(req.url).searchParams.get('project_id');
  let rows = await getSalesInvoices({ projectId: projectId ? Number(projectId) : undefined });
  // Global company selector — not when asked for one project's invoices (that project is one company).
  if (!projectId) rows = filterByCompany(rows, getSelectedCompanyFor(user));
  return NextResponse.json(await scopeRows(user, 'invoices', rows)); // plan 2a
}
