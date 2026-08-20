// app/api/chart-of-accounts/route.js — ACCOUNTING-IMPLEMENTATION-PLAN.md Phase 5. Same add-only
// shape as app/api/gst-rates/route.js. Seeded per company by lib/db.js; this lets Accounts add a
// further account beyond the default set (code/account_type fixed once created — editing here is
// limited to name/is_active, same "immutable code" convention every real chart of accounts follows).
import { NextResponse } from 'next/server';
import { execute } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { getChartOfAccounts } from '@/lib/data';
import { COMPANY_NAMES } from '@/lib/qc-doc-pdf.js';

export async function GET(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Accounts');
  if (denied) return denied;
  const { searchParams } = new URL(req.url);
  const company = COMPANY_NAMES.includes(searchParams.get('company')) ? searchParams.get('company') : COMPANY_NAMES[0];
  return NextResponse.json(await getChartOfAccounts(company));
}

export async function POST(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Accounts');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Accounts', 'accounts.chart_of_accounts.write');
  if (actionDenied) return actionDenied;
  const b = await req.json();
  const company = COMPANY_NAMES.includes(b.company) ? b.company : COMPANY_NAMES[0];
  if (!b.code || !b.name || !['asset', 'liability', 'equity', 'income', 'expense'].includes(b.account_type)) {
    return NextResponse.json({ error: 'code, name, and a valid account_type are required' }, { status: 400 });
  }
  const { lastId } = await execute(
    'INSERT INTO chart_of_accounts (company, code, name, account_type, created_by) VALUES (?, ?, ?, ?, ?)',
    [company, b.code, b.name, b.account_type, user.username]
  );
  return NextResponse.json({ id: Number(lastId) });
}
