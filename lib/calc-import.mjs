// lib/calc-import.mjs — Phase 3.3 (Excel import half). Scoped down from Kimi's brief on purpose:
// "structured mapping wizard, not full formula parsing" — this reads a fixed Name/Value column
// shape (round-trips the "Variables" sheet lib/calc-export.js produces) rather than a drag-and-drop
// column-mapping UI. It only ever UPDATES the value of an existing, non-computed variable matched by
// exact name — it never creates a variable or touches a formula, so a bad import can't silently
// invent new registry entries or override a computed result. Same header-row-scan idiom as
// lib/master-import.mjs (parties/items), just a much smaller header set.
import * as XLSX from 'xlsx';

const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
const NAME_HEADERS = ['name', 'variable', 'variable name'];
const VALUE_HEADERS = ['value', 'design value'];

export function parseVariableValues(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: false, defval: '' });
    let nameCol = -1, valueCol = -1, headerRowIdx = -1;
    for (let r = 0; r < Math.min(rows.length, 10) && (nameCol === -1 || valueCol === -1); r++) {
      const row = rows[r] || [];
      row.forEach((cell, i) => {
        const n = norm(cell);
        if (nameCol === -1 && NAME_HEADERS.includes(n)) nameCol = i;
        if (valueCol === -1 && VALUE_HEADERS.includes(n)) valueCol = i;
      });
      if (nameCol !== -1 && valueCol !== -1) headerRowIdx = r;
    }
    if (headerRowIdx === -1) continue;

    const records = [];
    let skipped = 0;
    for (let r = headerRowIdx + 1; r < rows.length; r++) {
      const row = rows[r];
      if (!row || !row.some((c) => String(c ?? '').trim())) continue;
      const varName = String(row[nameCol] ?? '').trim();
      const value = Number(row[valueCol]);
      if (!varName || row[valueCol] === '' || Number.isNaN(value)) { skipped++; continue; }
      records.push({ name: varName, value });
    }
    return { sheetName: name, records, skipped };
  }
  return { sheetName: null, records: [], skipped: 0, error: `No sheet found with a "Name"/"Value" column pair (checked: ${wb.SheetNames.join(', ')})` };
}
