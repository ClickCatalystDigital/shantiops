// scripts/bank-match-selfcheck.mjs — node scripts/bank-match-selfcheck.mjs
// Pure-function checks for lib/bank-match.mjs's matchStatement(). No DB, no fake data written
// anywhere — every row here is invented purely to exercise the matching logic.
import { strict as assert } from 'node:assert';
import { matchStatement } from '../lib/bank-match.mjs';

function line(id, { debit = 0, credit = 0, entry_date, reconciled = false }) {
  return { id, debit, credit, reconciled, entry_date };
}
function stmt(date, amount, desc = '') { return { date, amount, description: desc }; }

// --- exact same-day match -> high confidence ---------------------------------------------------
{
  const ledger = [line(1, { debit: 1000, entry_date: '2026-08-10' })];
  const { matched, unmatchedStatement, unmatchedLedger } = matchStatement([stmt('2026-08-10', 1000)], ledger);
  assert.equal(matched.length, 1);
  assert.equal(matched[0].confidence, 'high');
  assert.equal(matched[0].line.id, 1);
  assert.equal(unmatchedStatement.length, 0);
  assert.equal(unmatchedLedger.length, 0);
}

// --- in-window (±3 days) match -> still high --------------------------------------------------
{
  const ledger = [line(1, { debit: 500, entry_date: '2026-08-10' })];
  const { matched } = matchStatement([stmt('2026-08-12', 500)], ledger, { toleranceDays: 3 });
  assert.equal(matched.length, 1);
  assert.equal(matched[0].confidence, 'high');
}

// --- out-of-window -> no match, both sides unmatched --------------------------------------------
{
  const ledger = [line(1, { debit: 500, entry_date: '2026-08-10' })];
  const { matched, unmatchedStatement, unmatchedLedger } = matchStatement([stmt('2026-08-20', 500)], ledger, { toleranceDays: 3 });
  assert.equal(matched.length, 0);
  assert.equal(unmatchedStatement.length, 1);
  assert.equal(unmatchedLedger.length, 1);
}

// --- sign mismatch (deposit vs a credit/outflow line) -> no match -------------------------------
{
  const ledger = [line(1, { credit: 500, entry_date: '2026-08-10' })]; // net = -500, an outflow
  const { matched, unmatchedStatement } = matchStatement([stmt('2026-08-10', 500)], ledger); // deposit, net = +500
  assert.equal(matched.length, 0);
  assert.equal(unmatchedStatement.length, 1);
}

// --- ambiguous: two ledger lines with the same amount -> both low, none auto-reconciled ---------
{
  const ledger = [
    line(1, { debit: 1000, entry_date: '2026-08-10' }),
    line(2, { debit: 1000, entry_date: '2026-08-11' }),
  ];
  const { matched, unmatchedLedger } = matchStatement([stmt('2026-08-10', 1000)], ledger);
  assert.equal(matched.length, 1, 'the one statement row gets a suggested pairing, not silence');
  assert.equal(matched[0].confidence, 'low', 'ambiguous candidate set must never be high-confidence');
  assert.equal(unmatchedLedger.length, 1, 'the other candidate line stays unmatched, not silently consumed');
}

// --- unmatched statement row (e.g. a bank charge never recorded) surfaces on its own -------------
{
  const ledger = [line(1, { debit: 1000, entry_date: '2026-08-10' })];
  const { matched, unmatchedStatement } = matchStatement(
    [stmt('2026-08-10', 1000), stmt('2026-08-11', -50, 'Bank charges')],
    ledger
  );
  assert.equal(matched.length, 1);
  assert.equal(unmatchedStatement.length, 1);
  assert.equal(unmatchedStatement[0].amount, -50);
}

// --- unmatched ledger line (posted but not yet appearing on the statement) surfaces on its own ---
{
  const ledger = [
    line(1, { debit: 1000, entry_date: '2026-08-10' }),
    line(2, { credit: 200, entry_date: '2026-08-15' }),
  ];
  const { matched, unmatchedLedger } = matchStatement([stmt('2026-08-10', 1000)], ledger);
  assert.equal(matched.length, 1);
  assert.equal(unmatchedLedger.length, 1);
  assert.equal(unmatchedLedger[0].id, 2);
}

// --- an already-reconciled ledger line is never a candidate, even on an exact amount/date match --
{
  const ledger = [line(1, { debit: 1000, entry_date: '2026-08-10', reconciled: true })];
  const { matched, unmatchedStatement } = matchStatement([stmt('2026-08-10', 1000)], ledger);
  assert.equal(matched.length, 0);
  assert.equal(unmatchedStatement.length, 1);
}

console.log('lib/bank-match.mjs selfcheck: all assertions passed');
