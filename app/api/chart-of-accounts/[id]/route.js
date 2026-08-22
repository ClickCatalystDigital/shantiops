// app/api/chart-of-accounts/[id]/route.js — ACCOUNTING-IMPLEMENTATION-PLAN.md Phase 9. The one
// editable field on an existing account: cash_flow_category, an override of
// lib/cash-flow.mjs's default classification rule (account type + Fixed Assets/Accumulated
// Depreciation code exception) for the Cash Flow Statement. Code/name/account_type stay immutable
// per the parent route's own "real chart of accounts never edits a live code" convention — this is
// a narrower, additive PATCH, not a general edit endpoint.
import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';

const VALID = ['operating', 'investing', 'financing'];

export async function PATCH(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Accounts');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Accounts', 'accounts.chart_of_accounts.write');
  if (actionDenied) return actionDenied;

  const account = await queryOne('SELECT id FROM chart_of_accounts WHERE id = ?', [params.id]);
  if (!account) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const b = await req.json();
  const category = b.cash_flow_category === null || b.cash_flow_category === '' ? null : b.cash_flow_category;
  if (category !== null && !VALID.includes(category)) {
    return NextResponse.json({ error: `cash_flow_category must be one of ${VALID.join(', ')}, or null` }, { status: 400 });
  }
  await execute('UPDATE chart_of_accounts SET cash_flow_category = ? WHERE id = ?', [category, params.id]);
  return NextResponse.json({ ok: true });
}
