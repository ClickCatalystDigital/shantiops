// lib/bank-statement-import.mjs — ACCOUNTING-IMPLEMENTATION-PLAN.md Phase 8. Same header-anchor
// shape as lib/gstr2b-import.mjs: find the header row by (normalized) text match, map columns by
// header text, skip any row missing its identity field (date + an amount). Header-anchor already
// tolerates column reordering and stray legend/opening-balance rows.
//
// ponytail: the HEADER_ALIASES map below is a reasonable superset of common Indian netbanking CSV
// export column headings (HDFC/ICICI/SBI/Axis-style), not verified against a real download of any
// specific bank yet — ACCOUNTING-IMPLEMENTATION-PLAN.md Phase 8 explicitly requires pinning this to
// a real statement file before trusting it in production. Run
// `node lib/bank-statement-import.mjs <real-file>` against each bank's actual export first; add or
// correct aliases here from what it reports, the same one-file-at-a-time process
// lib/gstr2b-import.mjs and lib/master-import.mjs already used. Do not extend this file's date
// parsing or column set from assumptions beyond what a real file has actually required.
import * as XLSX from 'xlsx';

const norm = (s) => String(s ?? '')
  .toLowerCase()
  .replace(/[₹.]/g, '')
  .replace(/\s+/g, ' ')
  .trim();

const num = (s) => {
  const n = parseFloat(String(s ?? '').replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : 0;
};

// header text (normalized) -> field name. One row can only claim one field; first alias to match
// wins, same as gstr2b's colToField construction.
const HEADER_ALIASES = {
  'date': 'date',
  'txn date': 'date',
  'transaction date': 'date',
  'value date': 'date',
  'value dt': 'date',
  'withdrawal amt': 'withdrawal',
  'withdrawal amount': 'withdrawal',
  'withdrawal': 'withdrawal',
  'debit': 'withdrawal',
  'dr': 'withdrawal',
  'deposit amt': 'deposit',
  'deposit amount': 'deposit',
  'deposit': 'deposit',
  'credit': 'deposit',
  'cr': 'deposit',
  'amount': 'amount', // ambiguous sign unless a separate dr/cr indicator column exists
  'dr/cr': 'drcr',
  'cr/dr': 'drcr',
  'transaction type': 'drcr',
  'narration': 'description',
  'description': 'description',
  'particulars': 'description',
  'remarks': 'description',
  'balance': 'balance',
  'closing balance': 'balance',
  'chq/ref no': 'ref',
  'reference no': 'ref',
  'reference number': 'ref',
};

function findHeaderRow(rows, maxRow = 25, minMatches = 2) {
  for (let r = 0; r < Math.min(rows.length, maxRow); r++) {
    const row = rows[r] || [];
    const colToField = {};
    let matches = 0;
    row.forEach((cell, i) => {
      const field = HEADER_ALIASES[norm(cell)];
      if (field && colToField[i] !== field) { colToField[i] = field; matches++; }
    });
    // A real bank statement's header row must at minimum carry a date and one amount-shaped
    // column (withdrawal/deposit pair, or amount) — not just any two aliased headers, so a stray
    // "Balance"+"Description" summary row above the real header can't be mistaken for it.
    const fields = new Set(Object.values(colToField));
    const hasDate = fields.has('date');
    const hasAmount = fields.has('withdrawal') || fields.has('deposit') || fields.has('amount');
    if (matches >= minMatches && hasDate && hasAmount) return { headerRowIdx: r, colToField };
  }
  return null;
}

// Normalizes to ISO YYYY-MM-DD. Indian netbanking exports vary (DD/MM/YYYY, DD-MM-YYYY,
// DD-Mon-YYYY, YYYY-MM-DD) — cover the common shapes; a real file that doesn't parse here needs a
// real fix, not a guessed regex extension.
function parseDate(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return s;
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (m) {
    const [, d, mo, y] = m;
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  m = s.match(/^(\d{1,2})[-\s]([A-Za-z]{3,})[-\s](\d{2,4})$/);
  if (m) {
    const [, d, monName, yRaw] = m;
    const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    const mo = months.indexOf(monName.slice(0, 3).toLowerCase()) + 1;
    if (!mo) return null;
    const y = yRaw.length === 2 ? `20${yRaw}` : yRaw;
    return `${y}-${String(mo).padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  return null;
}

// Collapses whichever amount shape the bank used into one signed net (+ = money in, matching
// lib/bank-match.mjs's ledger-sign convention: debit = money in, credit = money out).
function signedAmount(rec) {
  if (rec.withdrawal !== undefined || rec.deposit !== undefined) {
    return (rec.deposit || 0) - (rec.withdrawal || 0);
  }
  if (rec.amount !== undefined) {
    const isOut = /dr|debit|withdrawal/i.test(rec.drcr || '');
    const isIn = /cr|credit|deposit/i.test(rec.drcr || '');
    if (isOut) return -Math.abs(rec.amount);
    if (isIn) return Math.abs(rec.amount);
    return rec.amount; // already signed (some exports use negative for debits)
  }
  return 0;
}

export function parseBankStatement(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: false, defval: '' });
    const found = findHeaderRow(rows);
    if (!found) continue;
    const { headerRowIdx, colToField } = found;
    const columns = [...new Set(Object.values(colToField))];

    const rowsOut = [];
    let skipped = 0;
    for (let r = headerRowIdx + 1; r < rows.length; r++) {
      const row = rows[r];
      if (!row || !row.some(c => String(c ?? '').trim())) continue; // blank row
      const rec = {};
      for (const [i, field] of Object.entries(colToField)) {
        if (field === 'date' || field === 'description' || field === 'drcr' || field === 'ref') {
          rec[field] = String(row[i] ?? '').trim() || undefined;
        } else {
          rec[field] = num(row[i]);
        }
      }
      const date = parseDate(rec.date);
      if (!date) { skipped++; continue; } // no parseable date — legend/opening-balance/footer row
      const amount = signedAmount(rec);
      if (!amount) { skipped++; continue; } // zero-amount row (e.g. a pure balance carry-forward line)
      rowsOut.push({ date, amount: Math.round((amount + Number.EPSILON) * 100) / 100, description: rec.description || '', ref: rec.ref || null });
    }
    return { sheetName: name, columns, rows: rowsOut, skipped };
  }
  return { sheetName: null, columns: [], rows: [], skipped: 0, error: `no sheet with a recognizable bank-statement header (checked: ${wb.SheetNames.join(', ')})` };
}

const realFile = process.argv[2];
if (realFile) {
  const { readFileSync } = await import('node:fs');
  const result = parseBankStatement(readFileSync(realFile));
  console.log(JSON.stringify({ sheetName: result.sheetName, columns: result.columns, count: result.rows.length, skipped: result.skipped, sample: result.rows.slice(0, 5), error: result.error }, null, 2));
}
