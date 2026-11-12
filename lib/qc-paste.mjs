// Rows copied from Excel (tab-separated) into Form IV A parts or the mountings list. Pure: the
// browser uses it for the preview, the route again before inserting.
// Columns are fixed and in screen order; a first row that looks like headings is skipped.

export const PASTE_COLUMNS = {
  parts: ['part_no', 'part_name', 'size_t', 'size_w', 'size_l', 'qty'],
  mountings: ['description', 'size', 'moc', 'make', 'qty', 'serial_numbers'],
};
export const PASTE_LABELS = {
  parts: ['Part No.', 'Part name', 'T', 'W', 'L', 'Qty'],
  mountings: ['Description', 'Size', 'MOC', 'Make', 'Qty', 'Serial No(s)'],
};
// The column that must not be blank.
const REQUIRED = { parts: 'part_name', mountings: 'description' };
export const MAX_PASTE_ROWS = 500;

const HEADING = /^(part|description|desc|name|item|s\.?\s*no|sl|sr|t|w|l|size|qty|moc|make|serial)/i;

export function parsePaste(text, target) {
  const cols = PASTE_COLUMNS[target];
  if (!cols) throw new Error('Unknown paste target');
  let lines = String(text || '').replace(/\r\n?/g, '\n').split('\n').filter(l => l.trim());
  // Skip a heading row: every non-blank cell is a word that starts like a column name.
  const first = (lines[0] || '').split('\t').map(c => c.trim()).filter(Boolean);
  if (first.length && first.every(c => HEADING.test(c) && !/\d{2,}/.test(c))) lines = lines.slice(1);
  const rows = [], skipped = [];
  lines.forEach((line, i) => {
    const cells = line.split('\t').map(c => c.trim());
    const row = Object.fromEntries(cols.map((c, j) => [c, cells[j] || null]));
    if (!row[REQUIRED[target]]) skipped.push(i + 1);
    else rows.push(row);
  });
  return { rows: rows.slice(0, MAX_PASTE_ROWS), skipped, tooMany: rows.length > MAX_PASTE_ROWS };
}
