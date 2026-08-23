// lib/reports/excel.js — Excel export half of the Report Engine, mirroring lib/calc-export.js's
// shape (already-installed `xlsx`/SheetJS, no new dependency). Consumes the same {cols, rows} /
// {sections} shape lib/reports/render.js's toTable() already produces for the PDF — one computed
// result, three renderers (ground rule 2 in REPORT-ENGINE-PLAN.md), not a second calculation.
//
// Right-aligned columns (align === 'right') are always numeric in this codebase's column specs
// (money, qty, %, counts) — reparsed back into a real number so Excel's own SUM/sort/pivot work on
// them, instead of writing the fmt()-formatted display string ("Rs. 1,23,456.00") as inert text.
import * as XLSX from 'xlsx';

// fmt() (lib/report-pdf.js) wraps negatives in parens — "(Rs. 17,700.00)" — and some columns are
// raw numbers already (STOCK_VALUATION_COLS' On Hand), others are "NN%" strings. Handles all three
// without needing a per-column raw accessor; only a column whose display string can't be reversed
// at all would need one (none exist in this codebase's specs today).
function parseDisplayNumber(display) {
  if (typeof display === 'number') return display;
  const s = String(display ?? '').trim();
  if (!s) return null;
  const negative = s.startsWith('(') && s.endsWith(')');
  const body = negative ? s.slice(1, -1) : s;
  // Match the digit-group(s) only — a naive "strip non-digits" would leave the "." in "Rs." behind
  // as a stray decimal point ("Rs. 1,23,456.78" -> ".123456.78" -> NaN). Taking the LAST digit-group
  // match sidesteps any letters-with-punctuation prefix without needing to special-case "Rs.".
  const matches = body.match(/[\d,]+(?:\.\d+)?/g);
  if (!matches) return null;
  const n = Number(matches[matches.length - 1].replace(/,/g, ''));
  if (Number.isNaN(n)) return null;
  return negative ? -n : n;
}

export function toWorkbook({ table }) {
  const wb = XLSX.utils.book_new();
  const sections = table.sections || [{ title: undefined, cols: table.cols, rows: table.rows }];
  sections.forEach((s, i) => {
    const header = s.cols.map((c) => c[0]);
    const body = s.rows.map((row) =>
      s.cols.map((c) => {
        const display = c[2](row);
        if (c[3] === 'right') {
          const n = parseDisplayNumber(display);
          if (n !== null) return n;
        }
        return display;
      })
    );
    const ws = XLSX.utils.aoa_to_sheet([header, ...body]);
    const name = (s.title || 'Report').replace(/[\\/?*[\]:]/g, '').slice(0, 31) || `Sheet${i + 1}`;
    XLSX.utils.book_append_sheet(wb, ws, name);
  });
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}
