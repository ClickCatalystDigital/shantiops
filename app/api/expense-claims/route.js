// app/api/expense-claims/route.js — workflow only, no GL (ACCOUNTING INTEGRATION POINT on the
// table itself, lib/db.js). total_amount is the sum of the submitted line items.
import { NextResponse } from 'next/server';
import { execute } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { getExpenseClaims } from '@/lib/data';
import { audit } from '@/lib/usb';

export async function GET(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'HR');
  if (denied) return denied;
  const params = new URL(req.url).searchParams;
  return NextResponse.json(await getExpenseClaims(params.get('status'), params.get('employee_id')));
}

export async function POST(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'HR');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'HR', 'hr.expense.submit');
  if (actionDenied) return actionDenied;
  const b = await req.json();
  const items = Array.isArray(b.items) ? b.items : [];
  if (!b.employee_id || !b.claim_date || !items.length) {
    return NextResponse.json({ error: 'employee_id, claim_date, and at least one item are required' }, { status: 400 });
  }
  const totalAmount = items.reduce((s, it) => s + Number(it.amount || 0), 0);
  const { lastId } = await execute(
    `INSERT INTO expense_claims (employee_id, claim_date, total_amount, status, advance_id, notes, created_by)
     VALUES (?, ?, ?, 'submitted', ?, ?, ?)`,
    [b.employee_id, b.claim_date, totalAmount, b.advance_id || null, b.notes || null, user.username]
  );
  const claimId = Number(lastId);
  let sortOrder = 0;
  for (const it of items) {
    await execute(
      'INSERT INTO expense_claim_items (expense_claim_id, expense_claim_type_id, expense_date, amount, description, sort_order) VALUES (?, ?, ?, ?, ?, ?)',
      [claimId, it.expense_claim_type_id || null, it.expense_date || null, it.amount, it.description || null, sortOrder++]
    );
  }
  await audit('expense_claim_submitted', { actor: user.username, detail: `employee #${b.employee_id}: ${totalAmount}` });
  return NextResponse.json({ id: claimId, total_amount: totalAmount });
}
