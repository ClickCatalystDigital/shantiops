// lib/bank-match.mjs — ACCOUNTING-IMPLEMENTATION-PLAN.md Phase 8. Dependency-free matching logic
// for bank-statement import, same precedent as lib/ledger.mjs/lib/depreciation.mjs: real
// calculation/matching logic lives here with its own selfcheck, never inline in a route.
//
// Extends the existing manual bank-reconciliation tick-off (journal_entry_lines.reconciled, §5w),
// it does not replace it — anything not confidently auto-matched here still falls back to that
// per-line toggle.

const DAY_MS = 24 * 60 * 60 * 1000;

function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }

// Ledger sign convention (lib/data.js's getBankLedgerLines): debit = money in, credit = money out.
function ledgerNet(line) { return round2((line.debit || 0) - (line.credit || 0)); }

// Statement rows come from lib/bank-statement-import.mjs already normalized to one signed `amount`
// field (positive = money in / deposit, negative = money out / withdrawal) — see that file's
// header-map registry for how each bank's own column shape gets there.
function statementNet(row) { return round2(row.amount || 0); }

function daysApart(dateA, dateB) {
  return Math.abs(new Date(dateA).getTime() - new Date(dateB).getTime()) / DAY_MS;
}

// matchStatement: pure, deterministic. `ledgerLines` should already be filtered to unreconciled
// lines by the caller (only an unreconciled line is a candidate at all — an already-ticked-off
// line can't be re-matched).
//
// Returns:
//   matched   — [{ stmt, line, confidence: 'high'|'low' }], 'high' only for a pair that is
//               mutually unique within tolerance (exactly one eligible line for that statement
//               row, and exactly one eligible statement row for that line) — never guessed when
//               ambiguous.
//   unmatchedStatement — statement rows with zero eligible ledger candidates within tolerance.
//   unmatchedLedger    — ledger lines with zero eligible statement candidates within tolerance.
export function matchStatement(statementRows, ledgerLines, { toleranceDays = 3 } = {}) {
  // candidatesByStmt[i] = Set of ledger indices eligible for statement row i, and vice versa.
  const candidatesByStmt = statementRows.map(() => []);
  const candidatesByLine = ledgerLines.map(() => []);

  statementRows.forEach((stmt, si) => {
    const sNet = statementNet(stmt);
    ledgerLines.forEach((line, li) => {
      if (line.reconciled) return; // never a candidate — already ticked off.
      if (ledgerNet(line) !== sNet) return;
      if (daysApart(stmt.date, line.entry_date) > toleranceDays) return;
      candidatesByStmt[si].push(li);
      candidatesByLine[li].push(si);
    });
  });

  const matched = [];
  const usedStmt = new Set();
  const usedLine = new Set();

  statementRows.forEach((stmt, si) => {
    const cands = candidatesByStmt[si];
    if (cands.length !== 1) return;
    const li = cands[0];
    if (candidatesByLine[li].length !== 1) return; // not mutually unique -> not auto-safe.
    matched.push({ stmt, line: ledgerLines[li], confidence: 'high' });
    usedStmt.add(si);
    usedLine.add(li);
  });

  // Every remaining statement row that has at least one candidate (but wasn't mutually unique)
  // surfaces as a 'low'-confidence pairing suggestion — the closest-by-date candidate — for manual
  // review, never auto-reconciled.
  statementRows.forEach((stmt, si) => {
    if (usedStmt.has(si)) return;
    const cands = candidatesByStmt[si].filter(li => !usedLine.has(li));
    if (!cands.length) return;
    const best = cands.reduce((a, b) =>
      daysApart(stmt.date, ledgerLines[b].entry_date) < daysApart(stmt.date, ledgerLines[a].entry_date) ? b : a
    );
    matched.push({ stmt, line: ledgerLines[best], confidence: 'low' });
    usedStmt.add(si);
  });

  const unmatchedStatement = statementRows.filter((_, si) => !usedStmt.has(si));
  const unmatchedLedger = ledgerLines.filter((line, li) => !line.reconciled && !usedLine.has(li) && !matched.some(m => m.line === line));

  return { matched, unmatchedStatement, unmatchedLedger };
}
