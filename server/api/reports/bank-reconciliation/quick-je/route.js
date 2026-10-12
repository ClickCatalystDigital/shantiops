// app/api/reports/bank-reconciliation/quick-je/route.js — ACCOUNTING-IMPLEMENTATION-PLAN.md Phase
// 8. One-click journal entry for a statement row that matched no ledger line at all (a bank
// charge, interest credit, or similar never recorded in the books) — surfaced by the Import
// Statement preview (app/api/reports/bank-reconciliation/import). Reuses the existing manual
// journal-entry engine (lib/ledger-post.js) verbatim — no new posting logic, just a 2-line
// Bank & Cash vs. counter-account entry created and posted in one step, then reconciled on the
// Bank & Cash side since it originated from an already-cleared statement row.
import { NextResponse } from 'next/server';
import { execute } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { createDraftJournalEntry, postDraftJournalEntry } from '@/lib/ledger-post';
import { ACCOUNT_CODES } from '@/lib/ledger.mjs';
import { COMPANY_NAMES } from '@/lib/qc-doc-pdf.js';

export async function POST(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Accounts');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Accounts', 'accounts.bank_reconciliation.write');
  if (actionDenied) return actionDenied;

  const b = await req.json();
  const company = COMPANY_NAMES.includes(b.company) ? b.company : COMPANY_NAMES[0];
  const amount = Number(b.amount);
  if (!b.date || !amount || !b.accountCode) {
    return NextResponse.json({ error: 'date, amount, and accountCode are required' }, { status: 400 });
  }
  const abs = Math.abs(amount);
  // amount > 0 = money in (statement deposit): Bank & Cash debited, counter-account credited.
  const lines = amount > 0
    ? [
        { accountCode: ACCOUNT_CODES.BANK_CASH, debit: abs, credit: 0 },
        { accountCode: b.accountCode, debit: 0, credit: abs },
      ]
    : [
        { accountCode: ACCOUNT_CODES.BANK_CASH, debit: 0, credit: abs },
        { accountCode: b.accountCode, debit: abs, credit: 0 },
      ];

  let entry;
  try {
    entry = await createDraftJournalEntry({ company, entryDate: b.date, description: b.description || 'Bank statement import', lines, createdBy: user.username });
    await postDraftJournalEntry(entry.id);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }

  await execute(
    `UPDATE journal_entry_lines SET reconciled = 1, reconciled_at = ?
       WHERE journal_entry_id = ? AND account_id = (SELECT id FROM chart_of_accounts WHERE company = ? AND code = ?)`,
    [new Date().toISOString(), entry.id, company, ACCOUNT_CODES.BANK_CASH]
  );

  return NextResponse.json({ ok: true, journalEntryId: entry.id, sourceId: entry.sourceId });
}
