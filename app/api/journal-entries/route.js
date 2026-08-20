// app/api/journal-entries/route.js — ACCOUNTING-IMPLEMENTATION-PLAN.md Phase 5 (+ completion
// pass). GET lists every entry (auto-posted and manual, any status — the General Ledger tab wants
// to see everything; lib/data.js's getLedgerLines() is the one place drafts are excluded, since
// that's what actually feeds the financial statements). POST creates a new Manual Journal Entry as
// a draft — every other entry in this table is still only ever auto-posted by lib/ledger-post.js
// off a document status change, this is the one direct-write path.
import { NextResponse } from 'next/server';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { getJournalEntries } from '@/lib/data';
import { createDraftJournalEntry } from '@/lib/ledger-post';
import { COMPANY_NAMES } from '@/lib/qc-doc-pdf.js';
import { todayISO } from '@/lib/date';

export async function GET(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Accounts');
  if (denied) return denied;
  const { searchParams } = new URL(req.url);
  const company = COMPANY_NAMES.includes(searchParams.get('company')) ? searchParams.get('company') : COMPANY_NAMES[0];
  const from = searchParams.get('from') || undefined;
  const to = searchParams.get('to') || undefined;
  const status = searchParams.get('status') || undefined;
  const sourceType = searchParams.get('source_type') || undefined;
  return NextResponse.json(await getJournalEntries(company, { from, to, status, sourceType }));
}

export async function POST(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Accounts');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Accounts', 'accounts.journal_entry.write');
  if (actionDenied) return actionDenied;

  const b = await req.json();
  const company = COMPANY_NAMES.includes(b.company) ? b.company : COMPANY_NAMES[0];
  const lines = Array.isArray(b.lines) ? b.lines.filter(l => l.accountCode && (Number(l.debit) || Number(l.credit))) : [];
  if (lines.length < 2) return NextResponse.json({ error: 'At least two lines are required' }, { status: 400 });
  const normalizedLines = lines.map(l => ({ accountCode: l.accountCode, debit: Number(l.debit) || 0, credit: Number(l.credit) || 0 }));

  let result;
  try {
    result = await createDraftJournalEntry({
      company, entryDate: b.entry_date || todayISO(), description: b.description ?? null,
      lines: normalizedLines, createdBy: user.username,
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
  return NextResponse.json({ id: result.id, source_id: result.sourceId });
}
