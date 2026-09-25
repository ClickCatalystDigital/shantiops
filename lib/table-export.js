// lib/table-export.js — Sales CRM plan 3b. Downloads the tables a report actually shows on screen,
// as CSV or Excel, so an export can never disagree with the screen. A cell (or anything inside it)
// carrying data-raw exports that raw value instead of its display text — money cells use it, since
// formatMoney() abbreviates (₹4.2L) and that would be lossy in a spreadsheet.
'use client';

function cellValue(cell) {
  const rawEl = cell.hasAttribute('data-raw') ? cell : cell.querySelector('[data-raw]');
  if (rawEl) {
    const raw = rawEl.getAttribute('data-raw');
    const n = Number(raw);
    return raw !== '' && !Number.isNaN(n) ? n : raw;
  }
  const text = cell.innerText.replace(/\s+/g, ' ').trim();
  return /^-?\d+(\.\d+)?$/.test(text) ? Number(text) : text;
}

// Every visible <table> under root → { title, rows: [[header…], [cells…]…] }.
export function readTables(root) {
  return [...root.querySelectorAll('table')]
    .filter(t => t.offsetParent !== null)
    .map((t, i) => {
      const heading = t.closest('[data-export-title]')?.getAttribute('data-export-title');
      const rows = [...t.rows].map(r => [...r.cells].map(cellValue));
      return { title: heading || `Table ${i + 1}`, rows };
    })
    .filter(t => t.rows.length);
}

function safeName(title) {
  return String(title || 'report').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'report';
}

export async function exportTables(root, title, format) {
  const tables = readTables(root);
  if (!tables.length) throw new Error('Nothing to export — this report has no table on screen');
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  tables.forEach((t, i) => {
    let name = t.title.replace(/[\\/?*[\]:]/g, '').slice(0, 31) || `Sheet${i + 1}`;
    if (wb.SheetNames.includes(name)) name = `${name.slice(0, 28)} ${i + 1}`;
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(t.rows), name);
  });
  const file = safeName(title);
  if (format === 'xlsx') {
    XLSX.writeFile(wb, `${file}.xlsx`);
    return;
  }
  const csv = wb.SheetNames.map(n => (wb.SheetNames.length > 1 ? `${n}\n` : '') + XLSX.utils.sheet_to_csv(wb.Sheets[n])).join('\n\n');
  const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: `${file}.csv` });
  a.click();
  URL.revokeObjectURL(url);
}
