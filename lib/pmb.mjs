// lib/pmb.mjs — tolerant parser for the client's hand-made "Project Master BOM" workbooks
// (SB-1104-PMB.xlsx etc.). One sheet per subsystem; at least three column layouts exist in the
// wild, sometimes within one workbook: status column first or last, single or double header rows
// (a department band above the real columns), and split "PO No. | Date" column pairs. There is no
// layout switch — one keyword header-scan handles all of them. Everything lands as free text;
// the app never parses dates/qty. Server-side only (imports xlsx); the ownership map lives in
// bom-fields.mjs so client components can import it without pulling xlsx into the bundle.
//
// Also the CSV import parser (2026-08-25) — XLSX.read() autodetects a plain CSV buffer and parses
// it into a single-sheet workbook (correctly handling quoted commas, CRLF, and a UTF-8 BOM prefix,
// verified directly), so it flows through the exact same parseSheet() logic below. HEADER_PATTERNS
// carries snake_case alternations (material_description, size_spec) alongside the natural-language
// PMB wording so our own CSV template's header row is recognized without a second parser to maintain.
import * as XLSX from 'xlsx';

// V2-CHANGES.md D4 (Phase 5.0) — the real PMB sheets carry freeform status text ("received",
// "closed", "CLOSED", "Received & Stored"...), not the app's own enum. Map the known words
// (case/whitespace-insensitive substring match, most-specific first) onto the new
// Enquiry/Comparison/Ordered/Transit/Received/Cancelled/In-Stock vocabulary (lib/bom-fields.mjs);
// anything unrecognized passes through as-is, same "unknown values kept as-is" precedent as
// BOM_STATUSES always documented — a real sheet's odd phrasing shouldn't be silently discarded.
const STATUS_WORD_MAP = [
  [/cancel/, 'Cancelled'],
  [/transit/, 'Transit'],
  [/receiv|closed|complete/, 'Received'],
  [/order|po\s*issu/, 'Ordered'],
  [/compar|quote|sourc/, 'Comparison'],
  [/pending|enquir/, 'Enquiry'],
];
function mapPurchaseStatus(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const low = s.toLowerCase();
  for (const [re, mapped] of STATUS_WORD_MAP) if (re.test(low)) return mapped;
  return s; // unrecognized — kept verbatim rather than discarded
}

// Ordered — specific before general (GRN qty before qty, GRN/issued before bare "receiv").
const HEADER_PATTERNS = [
  ['_slno', /sl\.?\s*no/],
  ['material_description', /part\s*desc|material_description/],
  ['moc', /material\s*spec|\bmoc\b/],
  ['size_spec', /\bsize\b|size_spec/],
  ['make', /\bmake\b|supplier/],
  ['grn_qty_text', /grn\s*received|grn.*qty/],
  ['pending_qty_text', /pending\s*qty/],
  ['qty_text', /qty/],
  ['pr_ref', /pr\s*no/],
  ['po_ref', /po\s*no/],
  ['grn_ref', /grn\s*no|\bgrn\b/],
  ['bqtc_ref', /bq.?\s*tc/],
  ['issued_ref', /issu/],
  ['received_ref', /receiv/], // only reached after the GRN patterns above
  ['purchase_status', /status/], // first column (layout A) or last (layout B) — position-agnostic
  ['remarks', /remark/],
];

// Ref fields a bare "Date" column can continue ("PO No. | Date" → one po_ref string).
const JOINABLE = new Set(['pr_ref', 'po_ref', 'grn_ref', 'issued_ref', 'received_ref', 'bqtc_ref']);

const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

function mapHeaderCell(text) {
  const n = norm(text);
  if (!n) return null;
  for (const [field, re] of HEADER_PATTERNS) if (re.test(n)) return field;
  return null;
}

// Map one header row: colIndex → field. Returns { mapping, fields:Set, unmapped:[headerText] }.
function mapHeaderRow(row) {
  const mapping = {};
  const unmapped = [];
  let lastRef = null;
  row.forEach((cell, i) => {
    const n = norm(cell);
    if (!n) return;
    if (n === 'date' && lastRef && JOINABLE.has(lastRef)) {
      mapping[i] = { joinTo: lastRef }; // continuation column
      return;
    }
    const field = mapHeaderCell(cell);
    if (field) {
      // First match wins per field — hand-made sheets sometimes repeat a keyword.
      if (!Object.values(mapping).some(m => m === field)) {
        mapping[i] = field;
        lastRef = JOINABLE.has(field) ? field : lastRef;
      }
    } else {
      unmapped.push(String(cell).replace(/\s+/g, ' ').trim());
    }
  });
  return { mapping, fields: new Set(Object.values(mapping).filter(m => typeof m === 'string')), unmapped };
}

function parseSheet(name, ws) {
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });

  // Header detection: first row in 0..7 mapping ≥3 fields including a description column.
  // Title rows and layout-C department-band rows ("PURCHASE DEPT. | STORES DEPT.") score ~0.
  let headerRow = -1, header = null;
  for (let r = 0; r < Math.min(rows.length, 8); r++) {
    const h = mapHeaderRow(rows[r]);
    if (h.fields.size >= 3 && h.fields.has('material_description')) { headerRow = r; header = h; break; }
  }
  if (headerRow === -1) {
    return { name, headerRow: null, columns: {}, unmappedColumns: [], items: [], skipped: [], error: 'no header row found' };
  }

  // Merged/vertically-spanned headers: if the next row also looks like a header, let it fill
  // columns the primary row left unmapped, and start data after it.
  let dataStart = headerRow + 1;
  const next = rows[dataStart] ? mapHeaderRow(rows[dataStart]) : null;
  if (next && next.fields.size >= 2) {
    for (const [i, field] of Object.entries(next.mapping)) {
      if (!(i in header.mapping) && (typeof field !== 'string' || !header.fields.has(field))) {
        header.mapping[i] = field;
        if (typeof field === 'string') header.fields.add(field);
      }
    }
    dataStart += 1;
  }

  const columns = {};
  for (const [i, field] of Object.entries(header.mapping)) {
    if (typeof field === 'string') columns[field] = String(rows[headerRow][i] ?? rows[dataStart - 1][i] ?? '').replace(/\s+/g, ' ').trim();
  }

  const items = [];
  const skipped = [];
  let groupLabel = null;

  for (let r = dataStart; r < rows.length; r++) {
    const row = rows[r];
    const rec = {};
    for (const [i, field] of Object.entries(header.mapping)) {
      const val = String(row[i] ?? '').trim();
      if (!val) continue;
      if (typeof field === 'object' && field.joinTo) {
        rec[field.joinTo] = rec[field.joinTo] ? `${rec[field.joinTo]} ${val}` : val;
      } else {
        rec[field] = rec[field] ? `${rec[field]} ${val}` : val;
      }
    }

    const desc = rec.material_description;
    const hasAny = Object.keys(rec).length > 0;
    if (!hasAny) continue; // blank row
    if (desc && /part\s*desc/.test(norm(desc))) { skipped.push({ row: r + 1, reason: 'repeated header row', cells: rec }); continue; }

    if (!desc) {
      skipped.push({ row: r + 1, reason: 'no description', cells: rec });
      continue;
    }

    // Assembly heading: a description with none of the material/procurement columns filled
    // (Sl.No and status may still be present — real headings carry both). Becomes the group
    // label for the items below it, not a row of its own.
    const substantive = ['moc', 'size_spec', 'make', 'qty_text', 'pr_ref', 'po_ref', 'grn_ref',
      'grn_qty_text', 'pending_qty_text', 'bqtc_ref', 'issued_ref', 'received_ref', 'remarks'];
    if (!substantive.some(f => rec[f])) {
      groupLabel = desc;
      continue;
    }

    // ponytail: datasheet spec rows (TYPE / FLOW cfm / RPM) import as items on purpose — the
    // preview shows them and Engineering deletes in-app; content-sniffing is the upgrade path.
    items.push({
      section: name.trim(),
      group_label: groupLabel,
      material_description: desc,
      moc: rec.moc ?? null,
      size_spec: rec.size_spec ?? null,
      make: rec.make ?? null,
      qty_text: rec.qty_text ?? null,
      purchase_status: mapPurchaseStatus(rec.purchase_status),
      pr_ref: rec.pr_ref ?? null,
      po_ref: rec.po_ref ?? null,
      grn_ref: rec.grn_ref ?? null,
      grn_qty_text: rec.grn_qty_text ?? null,
      pending_qty_text: rec.pending_qty_text ?? null,
      bqtc_ref: rec.bqtc_ref ?? null,
      issued_ref: rec.issued_ref ?? null,
      received_ref: rec.received_ref ?? null,
      remarks: rec.remarks ?? null,
    });
  }

  return { name: name.trim(), headerRow: headerRow + 1, columns, unmappedColumns: header.unmapped, items, skipped };
}

// buffer: Node Buffer or Uint8Array of the .xlsx file.
export function parsePmb(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const sheets = wb.SheetNames.map(n => parseSheet(n, wb.Sheets[n]));
  return {
    sheets,
    totalItems: sheets.reduce((a, s) => a + s.items.length, 0),
    totalSkipped: sheets.reduce((a, s) => a + s.skipped.length, 0),
  };
}
