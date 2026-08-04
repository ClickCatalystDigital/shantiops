// lib/master-import.mjs — parser for the client's real STERP master-data exports (V2-CHANGES.md
// Group 3): the "Party Master" template (identical on both the vendor and customer files — one
// parser feeds both `suppliers` and `customers`) and the "Item Master (Purchase)" catalog.
//
// Unlike lib/pmb.mjs (several hand-made BOM layouts in the wild, needs a tolerant keyword scan),
// these are single rigid ERP export templates — exact header text, fixed shape, just with a few
// legend/summary/marker rows sitting above the real header row. So: find the header row by exact
// text anchor, map columns by exact (normalized) header text, then skip any row missing the
// sheet's identity field (Party Name / Item Name) — that alone naturally skips every legend/marker
// row without special-casing them (confirmed against the real files: the marker row under the item
// header has no Item Name cell at all).
import * as XLSX from 'xlsx';

const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
const val = (s) => { const v = String(s ?? '').trim(); return v || null; };

// header text (normalized) -> field name. Order doesn't matter here (exact match, not regex).
const PARTY_HEADER_MAP = {
  'party code': 'party_code',
  'party name*': 'name', 'party name': 'name',
  'address1': 'address', 'address2': 'address2', 'address3': 'address3',
  'city': 'city',
  'state code': 'state_code',
  'state': 'state',
  'country': 'country',
  'pin code': 'pin_code',
  'area': 'area',
  'phone no.': 'phone', 'phone no': 'phone',
  'fax no.': 'fax', 'fax no': 'fax',
  'email id': 'email',
  'web site': 'website',
  'gstin no.': 'gst_no', 'gstin no': 'gst_no',
  'pan no.': 'pan', 'pan no': 'pan',
  'range': 'excise_range',
  'div.': 'division', 'div': 'division',
  'gst trans type': 'gst_trans_type',
  'business type': 'business_type',
};

const ITEM_HEADER_MAP = {
  'catetory': 'category', 'category': 'category', // "Catetory" is a typo in the client's own template — kept literally, matched as-is
  'group name': 'group_name',
  'main group': 'main_group',
  'sub group': 'sub_group',
  'group code': 'group_code',
  'item code': 'item_code',
  'item name 55 character limit': 'item_name',
  'detail desc 4000 char': 'detail_desc',
  'drgno.': 'drg_no', 'drgno': 'drg_no',
  'drgrev.': 'drg_rev', 'drgrev': 'drg_rev',
  'partno./cat no.': 'part_no', 'partno./catno.': 'part_no',
  'uom': 'uom',
  'cqty': 'cqty',
  'cfactor': 'cfactor',
  'convuom': 'conv_uom',
  'material proceess type': 'material_process_type', // "Proceess" is a typo in the client's own template
  'item type': 'item_type',
  'minqty': 'min_qty',
  'maxqty': 'max_qty',
  'lead time': 'lead_time',
  'tolerance +': 'tolerance_plus',
  'tolerance -': 'tolerance_minus',
  'class': 'class',
  'store location': 'store_location',
  'bin no': 'bin_no',
  'hsn code': 'hsn_code',
  'hsn desc': 'hsn_desc',
  'hsn item %': 'hsn_item_pct',
};

// Scan the first `maxRow` rows for the one whose normalized cell text matches enough of `headerMap`
// (by exact key) — real header rows in these files match ~15-22 keys at once; legend/summary rows
// match 0-1. Returns { headerRowIdx, colToField } or null.
function findHeaderRow(rows, headerMap, maxRow, minMatches) {
  for (let r = 0; r < Math.min(rows.length, maxRow); r++) {
    const row = rows[r] || [];
    const colToField = {};
    let matches = 0;
    row.forEach((cell, i) => {
      const field = headerMap[norm(cell)];
      if (field && !(colToField[i] === field)) {
        colToField[i] = field;
        matches++;
      }
    });
    if (matches >= minMatches) return { headerRowIdx: r, colToField };
  }
  return null;
}

// Scans every sheet (vendor/customer files carry extra reference sheets — GSTIN cheat-sheets,
// state-code lookups — that won't match the party header at all) and uses whichever one actually
// has the header, rather than requiring the caller to know the exact sheet name/casing. Tolerant of
// a re-export renaming or reordering sheets, same reasoning as pmb.mjs's per-sheet scan.
function parseWorkbook(buffer, headerMap, minMatches, identityField) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: false, defval: '' });
    const found = findHeaderRow(rows, headerMap, 10, minMatches);
    if (!found) continue;
    const { headerRowIdx, colToField } = found;
    const columns = [...new Set(Object.values(colToField))];

    const records = [];
    let skipped = 0;
    for (let r = headerRowIdx + 1; r < rows.length; r++) {
      const row = rows[r];
      if (!row || !row.some(c => String(c ?? '').trim())) continue; // blank row
      const rec = {};
      for (const [i, field] of Object.entries(colToField)) rec[field] = val(row[i]);
      if (!rec[identityField]) { skipped++; continue; } // legend/marker/summary row — no identity field
      records.push(rec);
    }
    return { sheetName: name, columns, records, skipped };
  }
  return { sheetName: null, columns: [], records: [], skipped: 0, error: `no sheet with a recognizable header (checked: ${wb.SheetNames.join(', ')})` };
}

// Vendor and customer files use the identical template — one parser feeds both `suppliers` and
// `customers`.
export function parsePartyMaster(buffer) {
  return parseWorkbook(buffer, PARTY_HEADER_MAP, 8, 'name');
}

export function parseItemMaster(buffer) {
  return parseWorkbook(buffer, ITEM_HEADER_MAP, 8, 'item_name');
}
