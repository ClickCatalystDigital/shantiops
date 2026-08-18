// app/api/expense-claims/[id]/route.js — approve/reject/mark-paid. Approving a claim that
// references an advance bumps that advance's settled_amount (simple running total, no ledger).
import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { getExpenseClaimDetail } from '@/lib/data';
import { audit } from '@/lib/usb';

const STATUSES = ['draft', 'submitted', 'approved', 'rejected', 'paid'];

export async function GET(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'HR');
  if (denied) return denied;
  const detail = await getExpenseClaimDetail(params.id);
  if (!detail) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(detail);
}

export async function PATCH(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'HR');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'HR', 'hr.expense.decide');
  if (actionDenied) return actionDenied;
  const b = await req.json();
  if (!STATUSES.includes(b.status)) return NextResponse.json({ error: 'Invalid status' }, { status: 400 });

  const claim = await queryOne('SELECT * FROM expense_claims WHERE id = ?', [params.id]);
  if (!claim) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (b.status === 'approved') {
    await execute("UPDATE expense_claims SET status = 'approved', approved_by = ?, approved_at = CURRENT_TIMESTAMP WHERE id = ?", [user.username, params.id]);
    if (claim.advance_id) {
      await execute(
        `UPDATE employee_advances SET settled_amount = MIN(amount, settled_amount + ?),
           status = CASE WHEN settled_amount + ? >= amount THEN 'settled' ELSE status END
         WHERE id = ?`,
        [claim.total_amount, claim.total_amount, claim.advance_id]
      );
    }
  } else {
    await execute('UPDATE expense_claims SET status = ? WHERE id = ?', [b.status, params.id]);
  }
  await audit(`expense_claim_${b.status}`, { actor: user.username, detail: `#${params.id}` });
  return NextResponse.json({ ok: true });
}
