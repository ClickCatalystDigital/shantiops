// app/api/journal-entry-lines/[id]/reconcile/route.js — ACCOUNTING-IMPLEMENTATION-PLAN.md Phase 5
// completion. Toggles one Bank & Cash ledger line's reconciled flag — the whole bank
// reconciliation workflow (see app/api/reports/bank-reconciliation).
import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';

export async function PATCH(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Accounts');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Accounts', 'accounts.bank_reconciliation.write');
  if (actionDenied) return actionDenied;

  const line = await queryOne('SELECT id FROM journal_entry_lines WHERE id = ?', [params.id]);
  if (!line) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const b = await req.json();
  const reconciled = b.reconciled ? 1 : 0;
  await execute(
    'UPDATE journal_entry_lines SET reconciled = ?, reconciled_at = ? WHERE id = ?',
    [reconciled, reconciled ? new Date().toISOString() : null, params.id]
  );
  return NextResponse.json({ ok: true });
}
