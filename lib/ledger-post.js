// lib/ledger-post.js — ACCOUNTING-IMPLEMENTATION-PLAN.md Phase 5 (+ completion pass). DB-touching
// orchestration around lib/ledger.mjs's pure line builders: looks up account ids by code, writes
// journal_entries + journal_entry_lines. journal_entries has a UNIQUE(source_type, source_id) — the
// upfront SELECT in postJournalEntry() just makes that guard cheap and explicit instead of relying
// on a thrown constraint violation, so a status PATCH that fires twice (e.g. re-saving "issued") is
// a no-op the second time, not an error.
import { execute, queryOne, queryAll, nextCounterValue } from './db';
import { assertBalanced, reversedLines } from './ledger.mjs';

async function insertEntryWithLines({ company, entryDate, sourceType, sourceId, description, lines, createdBy, status, reversalOfId }) {
  assertBalanced(lines);
  const accounts = await queryAll('SELECT id, code FROM chart_of_accounts WHERE company = ?', [company]);
  const idByCode = new Map(accounts.map(a => [a.code, a.id]));

  const { lastId } = await execute(
    `INSERT INTO journal_entries (company, entry_date, source_type, source_id, description, created_by, status, reversal_of_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [company, entryDate, sourceType, sourceId, description ?? null, createdBy ?? null, status, reversalOfId ?? null]
  );
  const entryId = Number(lastId);
  let sortOrder = 0;
  for (const line of lines) {
    const accountId = idByCode.get(line.accountCode);
    if (!accountId) throw new Error(`No chart_of_accounts row for code ${line.accountCode} / company ${company}`);
    await execute(
      `INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, sort_order) VALUES (?, ?, ?, ?, ?)`,
      [entryId, accountId, line.debit || 0, line.credit || 0, sortOrder++]
    );
  }
  return entryId;
}

// Auto-posting off a document event (Sales Invoice issue, Vendor Bill approval, ...) — always
// lands 'posted' immediately, same as every phase before this one. Idempotent per source document.
export async function postJournalEntry({ company, entryDate, sourceType, sourceId, description, lines, createdBy }) {
  const already = await queryOne(
    'SELECT id FROM journal_entries WHERE source_type = ? AND source_id = ?',
    [sourceType, sourceId]
  );
  if (already) return already.id;
  return insertEntryWithLines({ company, entryDate, sourceType, sourceId, description, lines, createdBy, status: 'posted' });
}

// --- Manual Journal Entry: draft -> post -> (immutable) -> reversal --------------------------------
// source_id is a real sequential reference number (its own counter), not tied to any other
// document — a manual journal is its own source, unlike every posting above.
export async function createDraftJournalEntry({ company, entryDate, description, lines, createdBy }) {
  const sourceId = await nextCounterValue('manual_journal_no', 0);
  const entryId = await insertEntryWithLines({ company, entryDate, sourceType: 'manual', sourceId, description, lines, createdBy, status: 'draft' });
  return { id: entryId, sourceId };
}

// Full line replacement while draft — a draft is meant to be edited before posting; once posted it
// is immutable (enforced by only ever calling this after checking status === 'draft' in the route).
export async function updateDraftJournalEntry(entryId, { entryDate, description, lines }) {
  assertBalanced(lines);
  const entry = await queryOne('SELECT * FROM journal_entries WHERE id = ?', [entryId]);
  const accounts = await queryAll('SELECT id, code FROM chart_of_accounts WHERE company = ?', [entry.company]);
  const idByCode = new Map(accounts.map(a => [a.code, a.id]));

  await execute('DELETE FROM journal_entry_lines WHERE journal_entry_id = ?', [entryId]);
  let sortOrder = 0;
  for (const line of lines) {
    const accountId = idByCode.get(line.accountCode);
    if (!accountId) throw new Error(`No chart_of_accounts row for code ${line.accountCode} / company ${entry.company}`);
    await execute(
      `INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, sort_order) VALUES (?, ?, ?, ?, ?)`,
      [entryId, accountId, line.debit || 0, line.credit || 0, sortOrder++]
    );
  }
  await execute(
    'UPDATE journal_entries SET entry_date = COALESCE(?, entry_date), description = COALESCE(?, description) WHERE id = ?',
    [entryDate ?? null, description ?? null, entryId]
  );
}

export async function postDraftJournalEntry(entryId) {
  const lines = await queryAll(
    `SELECT coa.code AS account_code, jel.debit, jel.credit FROM journal_entry_lines jel
       JOIN chart_of_accounts coa ON coa.id = jel.account_id WHERE jel.journal_entry_id = ?`,
    [entryId]
  );
  assertBalanced(lines);
  await execute("UPDATE journal_entries SET status = 'posted' WHERE id = ?", [entryId]);
}

// A posted entry is corrected by reversing it, never edited — every line's debit/credit swapped,
// posted as a brand-new entry linked back via reversal_of_id. Scoped to source_type = 'manual'
// only (checked by the caller): an auto-posted document (Sales Invoice, Vendor Bill, ...) already
// has its own correction mechanism (Credit Note / Debit Note) — reversing its GL entry directly
// would bypass that document trail, not fix it.
export async function reverseJournalEntry(entryId, { createdBy }) {
  const entry = await queryOne('SELECT * FROM journal_entries WHERE id = ?', [entryId]);
  const lines = await queryAll(
    `SELECT coa.code AS account_code, jel.debit, jel.credit FROM journal_entry_lines jel
       JOIN chart_of_accounts coa ON coa.id = jel.account_id WHERE jel.journal_entry_id = ?`,
    [entryId]
  );
  const sourceId = await nextCounterValue('manual_journal_no', 0);
  return insertEntryWithLines({
    company: entry.company,
    entryDate: entry.entry_date,
    sourceType: 'manual',
    sourceId,
    description: `Reversal of JE #${entry.source_id}${entry.description ? ` (${entry.description})` : ''}`,
    lines: reversedLines(lines),
    createdBy,
    status: 'posted',
    reversalOfId: entryId,
  });
}
