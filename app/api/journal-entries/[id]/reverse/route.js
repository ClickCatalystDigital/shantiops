// app/api/journal-entries/[id]/reverse/route.js — ACCOUNTING-IMPLEMENTATION-PLAN.md Phase 5
// completion. Reverses a posted Manual Journal Entry (debit/credit swapped on every line, posted
// as a brand-new entry). Scoped to source_type='manual' only — an auto-posted document already has
// its own correction mechanism (Credit Note / Debit Note); this route isn't a generic "undo any
// ledger entry" tool.
import { NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { reverseJournalEntry } from '@/lib/ledger-post';
import { audit } from '@/lib/usb';

export async function POST(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Accounts');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Accounts', 'accounts.journal_entry.post');
  if (actionDenied) return actionDenied;

  const entry = await queryOne('SELECT * FROM journal_entries WHERE id = ?', [params.id]);
  if (!entry) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (entry.source_type !== 'manual') return NextResponse.json({ error: 'Only a Manual Journal Entry can be reversed here' }, { status: 400 });
  if (entry.status !== 'posted') return NextResponse.json({ error: 'Only a posted entry can be reversed' }, { status: 400 });
  const alreadyReversed = await queryOne('SELECT id FROM journal_entries WHERE reversal_of_id = ?', [entry.id]);
  if (alreadyReversed) return NextResponse.json({ error: 'Already reversed' }, { status: 400 });

  const reversalId = await reverseJournalEntry(entry.id, { createdBy: user.username });
  await audit('journal_entry_reversed', { actor: user.username, detail: `JE #${entry.source_id} reversed by entry #${reversalId}` });
  return NextResponse.json({ id: reversalId });
}
