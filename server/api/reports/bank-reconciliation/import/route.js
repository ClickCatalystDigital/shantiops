// app/api/reports/bank-reconciliation/import/route.js — ACCOUNTING-IMPLEMENTATION-PLAN.md Phase 8.
// Statement import + auto-match, extending (not replacing) the existing manual tick-off at
// app/api/journal-entry-lines/[id]/reconcile. Same two-phase preview/confirm shape as
// app/api/gstr2b/upload/route.js:
//   POST file + company                       → parse + match only, nothing written
//   POST file + company + confirm=1           → reconcile every mutually-unique high-confidence match
//
// ponytail: stateless — the parsed statement rows are never persisted. Re-importing the same file
// just re-matches against current ledger state (already-reconciled lines drop out of the candidate
// pool in lib/bank-match.mjs, so nothing double-reconciles). Add a bank_statement_imports history
// table only if a real need for import history surfaces later.
import { NextResponse } from 'next/server';
import { execute } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { audit } from '@/lib/usb';
import { getBankLedgerLines } from '@/lib/data';
import { parseBankStatement } from '@/lib/bank-statement-import.mjs';
import { matchStatement } from '@/lib/bank-match.mjs';
import { COMPANY_NAMES } from '@/lib/qc-doc-pdf.js';

export async function POST(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Accounts');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Accounts', 'accounts.bank_reconciliation.write');
  if (actionDenied) return actionDenied;

  const form = await req.formData();
  const file = form.get('file');
  if (!file || typeof file.arrayBuffer !== 'function') {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 });
  }
  const company = COMPANY_NAMES.includes(form.get('company')) ? form.get('company') : COMPANY_NAMES[0];
  const toleranceDays = Number(form.get('toleranceDays')) || 3;

  const buffer = Buffer.from(await file.arrayBuffer());
  let parsed;
  try {
    parsed = parseBankStatement(buffer);
  } catch (e) {
    return NextResponse.json({ error: `Could not read file: ${e.message}` }, { status: 400 });
  }
  if (parsed.error) return NextResponse.json({ error: parsed.error }, { status: 400 });
  if (!parsed.rows.length) return NextResponse.json({ error: 'No transaction rows found in this file' }, { status: 400 });

  const ledgerLines = (await getBankLedgerLines(company)).filter(l => !l.reconciled);
  const { matched, unmatchedStatement, unmatchedLedger } = matchStatement(parsed.rows, ledgerLines, { toleranceDays });
  const high = matched.filter(m => m.confidence === 'high');
  const low = matched.filter(m => m.confidence === 'low');

  if (form.get('confirm') !== '1') {
    return NextResponse.json({
      preview: {
        filename: file.name,
        sheetName: parsed.sheetName,
        columns: parsed.columns,
        totalRows: parsed.rows.length,
        totalSkipped: parsed.skipped,
      },
      high,
      low,
      unmatchedStatement,
      unmatchedLedger,
    });
  }

  const now = new Date().toISOString();
  for (const m of high) {
    await execute('UPDATE journal_entry_lines SET reconciled = 1, reconciled_at = ? WHERE id = ?', [now, m.line.id]);
  }
  await audit('bank_statement_imported', { actor: user.username, detail: `${company}: ${file.name} — ${high.length} auto-reconciled, ${low.length} need review, ${unmatchedStatement.length} unmatched statement rows` });

  return NextResponse.json({ reconciled: high.length, needsReview: low.length, unmatchedStatement: unmatchedStatement.length, unmatchedLedger: unmatchedLedger.length });
}
