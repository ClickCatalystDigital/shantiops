// app/api/journal-entries/[id]/route.js — ACCOUNTING-IMPLEMENTATION-PLAN.md Phase 5 completion.
// GET a single entry with its lines. PATCH action=update edits a draft's lines/date/description
// (draft only); action=post flips it to posted (immutable from then on — corrections use
// app/api/journal-entries/[id]/reverse). DELETE removes a draft that was never posted (a draft
// never touched the ledger, so deleting it is safe — a posted entry can never be deleted, only
// reversed).
import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { getJournalEntry } from '@/lib/data';
import { updateDraftJournalEntry, postDraftJournalEntry } from '@/lib/ledger-post';
import { audit } from '@/lib/usb';

export async function GET(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Accounts');
  if (denied) return denied;
  const entry = await getJournalEntry(params.id);
  if (!entry) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(entry);
}

export async function PATCH(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Accounts');
  if (denied) return denied;

  const entry = await queryOne('SELECT * FROM journal_entries WHERE id = ?', [params.id]);
  if (!entry) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (entry.source_type !== 'manual') {
    return NextResponse.json({ error: 'Only a Manual Journal Entry can be edited or posted here' }, { status: 400 });
  }

  const b = await req.json();

  if (b.action === 'post') {
    const actionDenied = await requireAction(user, 'Accounts', 'accounts.journal_entry.post');
    if (actionDenied) return actionDenied;
    if (entry.status !== 'draft') return NextResponse.json({ error: 'Only a draft can be posted' }, { status: 400 });
    try {
      await postDraftJournalEntry(entry.id);
    } catch (err) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    await audit('journal_entry_posted', { actor: user.username, detail: `JE #${entry.source_id}` });
    return NextResponse.json({ ok: true });
  }

  // Default action: edit the draft's lines/date/description.
  const actionDenied = await requireAction(user, 'Accounts', 'accounts.journal_entry.write');
  if (actionDenied) return actionDenied;
  if (entry.status !== 'draft') return NextResponse.json({ error: 'A posted journal entry is immutable — use reverse instead' }, { status: 400 });

  const lines = Array.isArray(b.lines) ? b.lines.filter(l => l.accountCode && (Number(l.debit) || Number(l.credit))) : [];
  if (lines.length < 2) return NextResponse.json({ error: 'At least two lines are required' }, { status: 400 });
  const normalizedLines = lines.map(l => ({ accountCode: l.accountCode, debit: Number(l.debit) || 0, credit: Number(l.credit) || 0 }));

  try {
    await updateDraftJournalEntry(entry.id, { entryDate: b.entry_date, description: b.description, lines: normalizedLines });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
  await audit('journal_entry_updated', { actor: user.username, detail: `JE #${entry.source_id}` });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Accounts');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Accounts', 'accounts.journal_entry.write');
  if (actionDenied) return actionDenied;

  const entry = await queryOne('SELECT * FROM journal_entries WHERE id = ?', [params.id]);
  if (!entry) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (entry.source_type !== 'manual' || entry.status !== 'draft') {
    return NextResponse.json({ error: 'Only a draft Manual Journal Entry can be deleted' }, { status: 400 });
  }
  await execute('DELETE FROM journal_entries WHERE id = ?', [params.id]); // journal_entry_lines cascades
  await audit('journal_entry_deleted', { actor: user.username, detail: `JE #${entry.source_id}` });
  return NextResponse.json({ ok: true });
}
