// lib/quotation-register-import.mjs — pure parsing for the old CRM's quotation register (a plain
// listing of issued quote numbers, 2,733 rows across two exports: "Open" and "Sent to Customer"
// status, 2026-09-28). Used by scripts/import-quotations.mjs.
// Header-only source: Customer / Quotation No. / Quotation Date / Prepared By / Status / Remarks —
// no products, price, or line items, so every imported row is a header-shell quotation.
import { customerKey } from './customer-match.mjs';
import { revisionNumber } from './quotation-approval.mjs';

const MONTHS = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };

export function parseDate(s) {
  const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(s.trim());
  if (!m || !MONTHS[m[2]]) return null;
  return `${m[3]}-${String(MONTHS[m[2]]).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

const JUNK_NAMES = new Set(['test', 'testing', 'xxx', 'xyz', 'abc', 'dummy', 'sample', 'n/a', 'na', '-', '']);
export function isJunkCustomer(name) {
  const nl = name.trim().toLowerCase();
  return JUNK_NAMES.has(nl) || /^test[\s\-_]/.test(nl) || /^\d+$/.test(name.trim());
}

// SB/STF prefix -> company, only when unambiguous (many rows carry typo'd/legacy prefixes — those
// are left null rather than guessed, matching the "never guess" rule).
export function companyFromQno(qno) {
  const u = qno.trim().toUpperCase();
  if (u.startsWith('SB/') || u.startsWith('SB-')) return 'Shanti Boilers';
  if (u.startsWith('STF/') || u.startsWith('STF-')) return 'Shanti Techno Fab';
  return null;
}

export function parseTsv(text, status) {
  const lines = text.split('\n').filter(l => l.trim());
  const header = lines[0].split('\t').map(h => h.trim());
  return lines.slice(1).map((line, i) => {
    const cells = line.split('\t');
    const row = {}; header.forEach((h, j) => (row[h] = (cells[j] || '').trim()));
    return {
      serial: row['Sr.No.'], customer: row['Customer'], qno: row['Quotation No.'],
      dateIso: parseDate(row['Quotation Date']), preparedBy: row['Prepared By'], status, line: i + 2,
    };
  });
}

function groupBy(rows, key) {
  const m = new Map();
  for (const r of rows) {
    const k = key(r);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  }
  return m;
}

// Classifies the combined row set into: excluded (junk / no qno / cross-customer qno collision) and
// candidates (grouped by qno, in date order, ready for customer matching + revision numbering).
export function classifyRows(rows) {
  const byQno = groupBy(rows.filter(r => r.qno), r => r.qno);
  const crossCustomerQnos = new Set([...byQno].filter(([, v]) => new Set(v.map(x => x.customer)).size > 1).map(([k]) => k));

  const excluded = [], candidates = [];
  for (const r of rows) {
    if (isJunkCustomer(r.customer)) excluded.push({ ...r, reason: 'test/junk customer name' });
    else if (!r.qno) excluded.push({ ...r, reason: 'no quotation number' });
    else if (crossCustomerQnos.has(r.qno)) excluded.push({ ...r, reason: 'same quotation number used by a different customer' });
    else candidates.push(r);
  }
  return { excluded, candidates };
}

// One entry per distinct qno among candidates, sorted oldest-first, with revision numbers assigned
// within a (qno, same customer) group — same customer + same base number on different dates = a
// real revision chain, per this app's own quotations.parent_quotation_id/revision_no shape.
export function buildQuotationGroups(candidates) {
  const byQno = groupBy(candidates, r => r.qno);
  const groups = [];
  for (const [qno, rowsForQno] of byQno) {
    const sorted = [...rowsForQno].sort((a, b) => (a.dateIso || '').localeCompare(b.dateIso || ''));
    groups.push({
      qno, customer: sorted[0].customer,
      revisions: sorted.map((r, n) => ({ ...r, revisionNo: n, no: n === 0 ? qno : revisionNumber(qno, n) })),
    });
  }
  return groups;
}

export function matcher(customers) {
  const byKey = groupBy(customers, c => customerKey(c.name));
  return name => {
    const hits = byKey.get(customerKey(name)) || [];
    if (hits.length === 1) return { customer: hits[0], reason: 'exact' };
    if (hits.length > 1) return { customer: null, reason: `${hits.length} customers share this name`, similar: hits };
    return { customer: null, reason: 'no match', similar: [] };
  };
}
