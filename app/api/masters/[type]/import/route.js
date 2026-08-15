import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, canAccessDepartment, requirePM } from '@/lib/auth';
import { audit } from '@/lib/usb';
import { parsePartyMaster, parseItemMaster } from '@/lib/master-import.mjs';

// V2 master-data import (V2-CHANGES.md Group 3) — suppliers/customers/items, one generic route.
// Same two-phase shape as app/api/projects/[id]/bom/import/route.js:
//   POST file                → parse only, return a preview (nothing written)
//   POST file + confirm=1    → wipe the target table, insert every parsed row
// Client-confirmed (2026-08-04): re-import is always a **full replace**, not an upsert — these are
// periodic STERP re-exports, not incremental edits, and losing a stale supplier_quotes/PO link is
// acceptable (demo data is reseedable; real POs get recreated from the PDF record if needed).
const TYPES = {
  suppliers: {
    parse: parsePartyMaster,
    table: 'suppliers',
    // Procurement owns suppliers day-to-day (same gate as the rest of /procurement).
    gate: (user) => canAccessDepartment(user, 'Procurement'),
    columns: ['name', 'party_code', 'gst_no', 'pan', 'phone', 'fax', 'email', 'website', 'address',
      'address2', 'address3', 'city', 'state', 'state_code', 'country', 'pin_code', 'area',
      'excise_range', 'division', 'gst_trans_type', 'business_type'],
    // A full supplier replace orphans anything pointing at the old rows: purchase_orders.supplier_id
    // and supplier_quotes.supplier_id both FK-reference suppliers(id) with no ON DELETE clause, so
    // Turso (unlike this app's local-sqlite fallback — FK enforcement is actually on here) rejects
    // `DELETE FROM suppliers` outright while any dependent row exists. Client-confirmed (2026-08-04):
    // losing POs/quotes on a supplier-master replace is fine ("we'll recreate a few from the PO PDFs
    // as fulfilled") — so clear the two dependent tables first. po_items cascades from
    // purchase_orders on its own (ON DELETE CASCADE); bom_items.selected_quote_id has no FK
    // (plain INTEGER), so it just goes stale, not a constraint violation.
    clearFirst: ['purchase_orders', 'supplier_quotes'],
  },
  customers: {
    parse: parsePartyMaster,
    table: 'customers',
    // No Sales department/head exists yet (V2 Group 6.1, not built) — PM-only until it does.
    gate: (user) => requirePM(user) === null,
    columns: ['name', 'party_code', 'gst_no', 'pan', 'phone', 'fax', 'email', 'website', 'address',
      'address2', 'address3', 'city', 'state', 'state_code', 'country', 'pin_code', 'area',
      'excise_range', 'division', 'gst_trans_type', 'business_type'],
  },
  items: {
    parse: parseItemMaster,
    table: 'items',
    // Engineering owns item/BOM definitions (same gate as the PMB import).
    gate: (user) => canAccessDepartment(user, 'Engineering'),
    columns: ['category', 'group_name', 'main_group', 'sub_group', 'group_code', 'item_code',
      'item_name', 'detail_desc', 'drg_no', 'drg_rev', 'part_no', 'uom', 'cqty', 'cfactor',
      'conv_uom', 'material_process_type', 'item_type', 'min_qty', 'max_qty', 'lead_time',
      'tolerance_plus', 'tolerance_minus', 'class', 'store_location', 'bin_no', 'hsn_code',
      'hsn_desc', 'hsn_item_pct'],
  },
};

export async function POST(req, { params }) {
  const user = await getFreshSessionUser();
  const spec = TYPES[params.type];
  if (!spec) return NextResponse.json({ error: `Unknown master type "${params.type}"` }, { status: 404 });
  if (!spec.gate(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const form = await req.formData();
  const file = form.get('file');
  if (!file || typeof file.arrayBuffer !== 'function') {
    return NextResponse.json({ error: 'No .xlsx file provided' }, { status: 400 });
  }
  const buffer = Buffer.from(await file.arrayBuffer());

  let parsed;
  try {
    parsed = spec.parse(buffer);
  } catch (e) {
    return NextResponse.json({ error: `Could not read workbook: ${e.message}` }, { status: 400 });
  }
  if (parsed.error) return NextResponse.json({ error: parsed.error }, { status: 400 });
  if (!parsed.records.length) return NextResponse.json({ error: 'No rows found in this workbook' }, { status: 400 });

  const existing = await queryOne(`SELECT COUNT(*) AS n FROM ${spec.table}`);
  const dependentCounts = {};
  for (const dep of spec.clearFirst || []) {
    dependentCounts[dep] = (await queryOne(`SELECT COUNT(*) AS n FROM ${dep}`)).n;
  }

  if (form.get('confirm') !== '1') {
    return NextResponse.json({
      preview: {
        filename: file.name,
        sheetName: parsed.sheetName,
        columns: parsed.columns,
        totalRows: parsed.records.length,
        totalSkipped: parsed.skipped,
        sample: parsed.records.slice(0, 5),
        existingRows: existing.n,
        dependentCounts,
      },
    });
  }

  for (const dep of spec.clearFirst || []) await execute(`DELETE FROM ${dep}`);
  await execute(`DELETE FROM ${spec.table}`);
  const cols = spec.columns;
  const placeholders = cols.map(() => '?').join(', ');
  let n = 0;
  for (const rec of parsed.records) {
    await execute(
      `INSERT INTO ${spec.table} (${cols.join(', ')}) VALUES (${placeholders})`,
      cols.map(c => rec[c] ?? null));
    n++;
  }

  await audit('master_import', {
    actor: user.username,
    detail: JSON.stringify({
      type: params.type, filename: file.name, inserted: n, skipped: parsed.skipped,
      previous_rows: existing.n,
    }),
  });

  return NextResponse.json({ inserted: n, skipped: parsed.skipped, previousRows: existing.n });
}
