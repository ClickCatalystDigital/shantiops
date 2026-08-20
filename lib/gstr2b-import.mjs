// lib/gstr2b-import.mjs — parses the GST portal's own downloadable GSTR-2B "B2B" statement
// (Excel or CSV). Same header-anchor shape as lib/master-import.mjs's parsePartyMaster/
// parseItemMaster: find the header row by (normalized) exact text match, map columns by header
// text, skip any row missing the sheet's identity field.
//
// Built against the GST portal's published GSTR-2B Excel template column headings (a fixed,
// government-defined layout), not a real sample file — same caveat this codebase already carries
// for a first-cut parser (see ACCOUNTING-IMPLEMENTATION-PLAN.md Phase 6's Tally-import note: "get
// one real export sample, build the parser against that"). If a real portal download's headers
// drift from what's mapped below, this needs a quick header-map update, not a rewrite — the
// header-anchor approach already tolerates row/column reordering and stray legend rows.
import * as XLSX from 'xlsx';

const norm = (s) => String(s ?? '')
  .toLowerCase()
  .replace(/[₹()%]/g, '')
  .replace(/\s+/g, ' ')
  .trim();
const val = (s) => { const v = String(s ?? '').trim(); return v || null; };
const num = (s) => {
  const n = parseFloat(String(s ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
};

// header text (normalized) -> field name, taken from the GSTR-2B portal export's "B2B" sheet.
const B2B_HEADER_MAP = {
  'gstin of supplier': 'supplier_gstin',
  'trade/legal name': 'supplier_name',
  'invoice number': 'invoice_no',
  'invoice date': 'invoice_date',
  'invoice value': 'invoice_value',
  'taxable value': 'taxable_value',
  'integrated tax': 'igst',
  'central tax': 'cgst',
  'state/ut tax': 'sgst',
  'cess': 'cess',
  'itc availability': 'itc_availability',
  'reason': 'itc_reason',
};

function findHeaderRow(rows, maxRow, minMatches) {
  for (let r = 0; r < Math.min(rows.length, maxRow); r++) {
    const row = rows[r] || [];
    const colToField = {};
    let matches = 0;
    row.forEach((cell, i) => {
      const field = B2B_HEADER_MAP[norm(cell)];
      if (field && colToField[i] !== field) { colToField[i] = field; matches++; }
    });
    if (matches >= minMatches) return { headerRowIdx: r, colToField };
  }
  return null;
}

const NUMERIC_FIELDS = new Set(['invoice_value', 'taxable_value', 'igst', 'cgst', 'sgst', 'cess']);

export function parseGstr2b(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: false, defval: '' });
    const found = findHeaderRow(rows, 15, 5);
    if (!found) continue;
    const { headerRowIdx, colToField } = found;
    const columns = [...new Set(Object.values(colToField))];

    const records = [];
    let skipped = 0;
    for (let r = headerRowIdx + 1; r < rows.length; r++) {
      const row = rows[r];
      if (!row || !row.some(c => String(c ?? '').trim())) continue; // blank row
      const rec = {};
      for (const [i, field] of Object.entries(colToField)) {
        rec[field] = NUMERIC_FIELDS.has(field) ? num(row[i]) : val(row[i]);
      }
      if (!rec.invoice_no) { skipped++; continue; } // legend/total/summary row — no invoice number
      records.push(rec);
    }
    return { sheetName: name, columns, records, skipped };
  }
  return { sheetName: null, columns: [], records: [], skipped: 0, error: `no sheet with a recognizable GSTR-2B B2B header (checked: ${wb.SheetNames.join(', ')})` };
}
